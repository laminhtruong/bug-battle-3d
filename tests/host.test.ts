import { EventEmitter } from 'node:events'
import type { DataConnection } from 'peerjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTENT_HASH } from '@/content'
import { startHost } from '@/net/host'
import { PROTOCOL_VERSION, encodeMessage } from '@/net/protocol'

const { openHostPeer } = vi.hoisted(() => ({ openHostPeer: vi.fn() }))
vi.mock('@/net/peer', () => ({ openHostPeer }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function createHost() {
  vi.stubGlobal('window', globalThis)
  const peer = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  openHostPeer.mockResolvedValue({ peer, code: 'abcde' })
  const handlers = {
    onLobby: vi.fn(),
    onStart: vi.fn(),
    onResults: vi.fn(),
    onError: vi.fn(),
    onClosed: vi.fn(),
  }
  const host = await startHost({ playerName: 'Host', handlers })
  return { host, peer, handlers }
}

function connect(peer: EventEmitter, id: string) {
  const connection = Object.assign(new EventEmitter(), {
    peer: id,
    open: true,
    send: vi.fn(),
    close: vi.fn(),
  })
  peer.emit('connection', connection as unknown as DataConnection)
  connection.emit(
    'data',
    encodeMessage({
      v: PROTOCOL_VERSION,
      t: 'hello',
      name: id,
      contentHash: CONTENT_HASH,
    }),
  )
  return connection
}

describe('host session', () => {
  it('rejects a duplicate peer without losing the original player on close', async () => {
    vi.useFakeTimers()
    const { host, peer, handlers } = await createHost()
    const original = connect(peer, 'guest')
    const duplicate = connect(peer, 'guest')
    expect(JSON.parse(duplicate.send.mock.calls[0]![0]).t).toBe('error')
    duplicate.emit('close')
    host.start()
    expect(host.getState()?.snakes.filter((snake) => snake.control === 'human')).toHaveLength(2)
    expect(original.send).toHaveBeenCalled()
    expect(handlers.onStart).toHaveBeenCalledOnce()
    host.dispose()
  })

  it('does not restart a running or disposed match', async () => {
    const { host, handlers } = await createHost()
    host.start()
    const world = host.getState()
    host.start()
    expect(host.getState()).toBe(world)
    expect(handlers.onStart).toHaveBeenCalledOnce()
    host.dispose()
    host.start()
    expect(handlers.onStart).toHaveBeenCalledOnce()
  })
})
