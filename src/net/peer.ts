import Peer, { type DataConnection } from 'peerjs'

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

export function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id) : new Peer()
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
      connection.off('close', onClose)
      resolve()
    }
    const onClose = (): void => {
      connection.off('open', onOpen)
      reject(new Error('the host did not answer'))
    }
    connection.on('open', onOpen)
    connection.on('close', onClose)
  })
}
