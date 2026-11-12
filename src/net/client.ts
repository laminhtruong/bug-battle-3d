import { CONTENT_HASH } from '@/content'
import type { SoundName } from '@/data/sounds'
import type { RenderState } from '@/render/state'
import { connectToHost, openPeer, waitForConnection } from './peer'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseHostMessage,
  type LobbyPlayer,
  type ResultRow,
} from './protocol'
import { toRenderState } from './snapshot'

const HANDSHAKE_TIMEOUT_MS = 15_000
const INPUT_INTERVAL_MS = 1000 / 30

export interface ClientHandlers {
  onLobby(players: LobbyPlayer[]): void
  onStart(): void
  onSnapshot(state: RenderState): void
  /** Sound effects reported by the host. */
  onSound(name: SoundName): void
  onResults(results: ResultRow[]): void
  onError(message: string): void
  onClosed(message: string): void
}

export interface ClientOptions {
  roomCode: string
  playerName: string
  handlers: ClientHandlers
}

export interface ClientSession {
  playerId: string
  sendInput(x: number, z: number): void
  dispose(): void
}

export async function joinRoom(options: ClientOptions): Promise<ClientSession> {
  const peer = await openPeer()
  const connection = connectToHost(peer, options.roomCode)

  try {
    await waitForConnection(connection)
  } catch (error) {
    peer.destroy()
    throw error
  }

  let playerId = ''
  let resolveWelcome: ((id: string) => void) | undefined
  let rejectWelcome: ((error: Error) => void) | undefined
  const welcome = new Promise<string>((resolve, reject) => {
    resolveWelcome = resolve
    rejectWelcome = reject
  })

  let joined = false
  let disposed = false

  connection.on('data', (raw) => {
    const message = parseHostMessage(raw)
    if (!message) {
      return
    }
    switch (message.t) {
      case 'welcome':
        playerId = message.playerId
        resolveWelcome?.(message.playerId)
        resolveWelcome = undefined
        return
      case 'error':
        if (joined) {
          options.handlers.onError(message.message)
        } else {
          rejectWelcome?.(new Error(message.message))
        }
        return
      case 'lobby':
        options.handlers.onLobby(message.players)
        return
      case 'start':
        if (message.contentHash !== CONTENT_HASH) {
          options.handlers.onError('Content mismatch: update the game on both sides.')
          return
        }
        options.handlers.onStart()
        return
      case 'snap':
        for (const sound of message.sfx ?? []) {
          // Only the effects of the own snake are audible.
          if (sound.by === playerId) {
            options.handlers.onSound(sound.name)
          }
        }
        options.handlers.onSnapshot(toRenderState(message))
        return
      case 'end':
        options.handlers.onResults(message.results)
        return
    }
  })

  connection.on('close', () => {
    if (disposed) {
      return
    }
    if (joined) {
      options.handlers.onClosed('The host left the match.')
    } else {
      rejectWelcome?.(new Error('The host closed the connection.'))
    }
  })

  peer.on('error', (error) => {
    if (!disposed && joined) {
      options.handlers.onError(error.message)
    }
  })

  const timeout = window.setTimeout(() => {
    rejectWelcome?.(new Error('The host did not answer.'))
  }, HANDSHAKE_TIMEOUT_MS)

  connection.send(
    encodeMessage({
      v: PROTOCOL_VERSION,
      t: 'hello',
      name: options.playerName,
      contentHash: CONTENT_HASH,
    }),
  )

  try {
    await welcome
  } catch (error) {
    window.clearTimeout(timeout)
    connection.close()
    peer.destroy()
    throw error
  }
  window.clearTimeout(timeout)
  joined = true

  let sequence = 0
  let lastSent = 0

  return {
    playerId,
    sendInput: (x, z) => {
      const now = performance.now()
      if (now - lastSent < INPUT_INTERVAL_MS || !connection.open) {
        return
      }
      lastSent = now
      sequence += 1
      connection.send(
        encodeMessage({
          v: PROTOCOL_VERSION,
          t: 'input',
          seq: sequence,
          x: Math.max(-1, Math.min(1, x)),
          z: Math.max(-1, Math.min(1, z)),
        }),
      )
    },
    dispose: () => {
      disposed = true
      connection.close()
      peer.destroy()
    },
  }
}
