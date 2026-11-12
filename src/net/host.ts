import type { DataConnection } from 'peerjs'
import { CONTENT_HASH, DEFAULT_HEAD_ID, classicArena } from '@/content'
import { BALANCE } from '@/data/balance'
import type { SoundName } from '@/data/sounds'
import type { RenderState } from '@/render/state'
import { soundForEvent } from '@/audio/sfx'
import { tickWorld } from '@/sim/tick'
import type { PlayerSetup } from '@/sim/spawn'
import type { World } from '@/sim/types'
import { createWorld, playerSnakes } from '@/sim/world'
import { openHostPeer } from './peer'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseClientMessage,
  type HostMessage,
  type LobbyPlayer,
  type ResultRow,
} from './protocol'
import { createSnapshot } from './snapshot'

const SNAPSHOT_INTERVAL = 1 / 15
const INPUT_INTERVAL_MS = 1000 / 60

export interface HostHandlers {
  onLobby(code: string, players: LobbyPlayer[]): void
  onStart(): void
  onResults(results: ResultRow[]): void
  onError(message: string): void
  onClosed(): void
}

export interface HostOptions {
  playerName: string
  handlers: HostHandlers
}

export interface HostSession {
  code: string
  start(): void
  update(dt: number): void
  setInput(x: number, z: number): void
  getState(): RenderState | undefined
  /** Sound effects of the events that happened since the last call. */
  drainSounds(): SoundName[]
  dispose(): void
}

interface RemotePlayer {
  connection: DataConnection
  playerId: string
  name: string
  lastInputAt: number
}

function send(connection: DataConnection, message: HostMessage): void {
  if (connection.open) {
    connection.send(encodeMessage(message))
  }
}

export async function startHost({ playerName, handlers }: HostOptions): Promise<HostSession> {
  const { peer, code } = await openHostPeer()

  const remotes = new Map<string, RemotePlayer>()
  let nextPlayerId = 1
  let world: World | undefined
  let seed = 0
  let resultsSent = false
  let snapshotClock = 0
  let disposed = false
  const pendingSounds: SoundName[] = []
  const localSounds: SoundName[] = []
  const hostInput = { x: 0, z: 0 }

  const lobbyPlayers = (): LobbyPlayer[] => [
    { id: 'host', name: playerName },
    ...[...remotes.values()].map((remote) => ({ id: remote.playerId, name: remote.name })),
  ]

  const broadcast = (message: HostMessage): void => {
    for (const remote of remotes.values()) {
      send(remote.connection, message)
    }
  }

  const broadcastLobby = (): void => {
    const players = lobbyPlayers()
    broadcast({ v: PROTOCOL_VERSION, t: 'lobby', players })
    handlers.onLobby(code, players)
  }

  const rejectConnection = (connection: DataConnection, message: string): void => {
    send(connection, { v: PROTOCOL_VERSION, t: 'error', message })
    window.setTimeout(() => connection.close(), 250)
  }

  const findSnake = (playerId: string) => world?.snakes.find((snake) => snake.id === playerId)

  const handleConnection = (connection: DataConnection): void => {
    let remote: RemotePlayer | undefined

    connection.on('data', (raw) => {
      const message = parseClientMessage(raw)
      if (!message) {
        return
      }
      if (message.t === 'hello') {
        if (remote) {
          return
        }
        if (message.contentHash !== CONTENT_HASH) {
          rejectConnection(connection, 'Content mismatch: update the game on both sides.')
          return
        }
        if (world) {
          rejectConnection(connection, 'The match already started.')
          return
        }
        if (remotes.size >= BALANCE.maxPlayers - 1) {
          rejectConnection(connection, 'The room is full.')
          return
        }
        remote = {
          connection,
          playerId: `player-${nextPlayerId}`,
          name: message.name,
          lastInputAt: 0,
        }
        nextPlayerId += 1
        remotes.set(connection.peer, remote)
        send(connection, { v: PROTOCOL_VERSION, t: 'welcome', playerId: remote.playerId })
        broadcastLobby()
        return
      }

      if (!remote) {
        return
      }
      const now = performance.now()
      if (now - remote.lastInputAt < INPUT_INTERVAL_MS) {
        return
      }
      remote.lastInputAt = now
      const snake = findSnake(remote.playerId)
      if (snake && snake.alive) {
        snake.steerX = message.x
        snake.steerZ = message.z
      }
    })

    connection.on('error', () => {
      // The close event below performs the cleanup.
    })

    connection.on('close', () => {
      if (!remote) {
        return
      }
      remotes.delete(connection.peer)
      const snake = findSnake(remote.playerId)
      if (snake && world && !world.ended) {
        // A dropped player keeps their snake, now driven by the bot AI.
        snake.control = 'bot'
        snake.steerX = 0
        snake.steerZ = 0
      }
      if (!world) {
        broadcastLobby()
      }
    })
  }

  peer.on('connection', handleConnection)
  peer.on('error', (error) => {
    if (!disposed) {
      handlers.onError(error.message)
    }
  })

  const sendStart = (): void => {
    if (!world) {
      return
    }
    const players = playerSnakes(world).map((snake) => ({
      id: snake.id,
      name: snake.name,
      slot: snake.slot,
      headId: snake.baseHeadId,
    }))
    broadcast({
      v: PROTOCOL_VERSION,
      t: 'start',
      seed,
      contentHash: CONTENT_HASH,
      players,
    })
  }

  const start = (): void => {
    const setups: PlayerSetup[] = [
      { id: 'host', name: playerName, control: 'human', slot: 0, headId: DEFAULT_HEAD_ID },
    ]
    for (const remote of remotes.values()) {
      setups.push({
        id: remote.playerId,
        name: remote.name,
        control: 'human',
        slot: setups.length,
        headId: DEFAULT_HEAD_ID,
      })
    }
    seed = (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0
    world = createWorld({
      seed,
      arena: classicArena,
      players: setups,
    })
    resultsSent = false
    snapshotClock = 0
    sendStart()
    handlers.onStart()
  }

  const update = (dt: number): void => {
    if (!world) {
      return
    }
    const hostSnake = findSnake('host')
    if (hostSnake && hostSnake.alive) {
      hostSnake.steerX = hostInput.x
      hostSnake.steerZ = hostInput.z
    }
    if (!world.ended) {
      tickWorld(world, dt)
    }
    for (const event of world.events) {
      const sound = soundForEvent(event)
      if (sound) {
        pendingSounds.push(sound)
      }
    }

    snapshotClock += dt
    if (snapshotClock >= SNAPSHOT_INTERVAL) {
      snapshotClock = 0
      const sounds = pendingSounds.splice(0)
      localSounds.push(...sounds)
      broadcast(createSnapshot(world, sounds))
    }

    if (world.ended && !resultsSent) {
      resultsSent = true
      const results = playerSnakes(world).map((snake) => ({
        name: snake.name,
        score: snake.score,
      }))
      broadcast({ v: PROTOCOL_VERSION, t: 'end', results })
      handlers.onResults(results)
    }
  }

  return {
    code,
    start,
    update,
    setInput: (x, z) => {
      hostInput.x = x
      hostInput.z = z
    },
    getState: () => world,
    drainSounds: () => localSounds.splice(0),
    dispose: () => {
      disposed = true
      for (const remote of remotes.values()) {
        remote.connection.close()
      }
      peer.destroy()
    },
  }
}
