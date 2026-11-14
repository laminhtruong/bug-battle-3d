import type Peer from 'peerjs'
import type { DataConnection } from 'peerjs'

const ROOM_PREFIX = 'bb3d-'
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const CODE_LENGTH = 5

function createRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  let code = ''
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return code
}

export function toPeerId(code: string): string {
  return `${ROOM_PREFIX}${code.trim().toLowerCase()}`
}

export async function openPeer(id?: string): Promise<Peer> {
  // peerjs is only needed for online play, so it is fetched on demand.
  const { default: peerClient } = await import('peerjs')
  return new Promise((resolve, reject) => {
    const peer = id ? new peerClient(id) : new peerClient()
    const onOpen = (): void => {
      peer.off('error', onError)
      resolve(peer)
    }
    const onError = (error: Error): void => {
      peer.off('open', onOpen)
      peer.destroy()
      reject(error instanceof Error ? error : new Error('could not reach the signaling server'))
    }
    peer.on('open', onOpen)
    peer.on('error', onError)
  })
}

/** Creates a peer whose id doubles as the room code, retrying on collisions. */
export async function openHostPeer(): Promise<{ peer: Peer; code: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = createRoomCode()
    try {
      return { peer: await openPeer(toPeerId(code)), code }
    } catch {
      // The id is taken, try another code.
    }
  }
  throw new Error('could not create a room code')
}

export function connectToHost(peer: Peer, code: string): DataConnection {
  return peer.connect(toPeerId(code), { reliable: true })
}

export function waitForConnection(connection: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    if (connection.open) {
      resolve()
      return
    }
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('the host did not answer'))
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const cleanup = (): void => {
      clearTimeout(timeout)
      connection.off('open', onOpen)
      connection.off('close', onClose)
      connection.off('error', onError)
    }
    const timeout = setTimeout(() => {
      onClose()
      connection.close()
    }, 15_000)
    connection.on('open', onOpen)
    connection.on('close', onClose)
    connection.on('error', onError)
  })
}
