import { EventEmitter } from 'node:events'
import type { DataConnection } from 'peerjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForConnection } from '@/net/peer'

afterEach(() => vi.useRealTimers())

function connection(open = false) {
  return Object.assign(new EventEmitter(), { open, close: vi.fn() })
}

describe('peer connection', () => {
  it('resolves an already open connection without attaching listeners', async () => {
    const peer = connection(true)
    await waitForConnection(peer as unknown as DataConnection)
    expect(peer.eventNames()).toEqual([])
  })

  it('times out an unanswered connection and removes listeners', async () => {
    vi.useFakeTimers()
    const peer = connection()
    const pending = waitForConnection(peer as unknown as DataConnection)
    const rejected = expect(pending).rejects.toThrow('the host did not answer')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    expect(peer.close).toHaveBeenCalledOnce()
    expect(peer.eventNames()).toEqual([])
  })

  it.each(['close', 'error'])('rejects on %s and clears the timer', async (event) => {
    vi.useFakeTimers()
    const peer = connection()
    const pending = waitForConnection(peer as unknown as DataConnection)
    const rejected = expect(pending).rejects.toThrow()
    peer.emit(event, new Error('connection failed'))
    await rejected
    expect(peer.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears timeout and listeners when the connection opens', async () => {
    vi.useFakeTimers()
    const peer = connection()
    const pending = waitForConnection(peer as unknown as DataConnection)
    peer.emit('open')
    await pending
    expect(peer.eventNames()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
