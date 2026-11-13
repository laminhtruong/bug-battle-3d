import './style.css'
import { playSound, soundsForEvent } from '@/audio/sfx'
import { startLoop } from '@/core/loop'
import { DEFAULT_HEAD_ID, classicArena } from '@/content'
import { BALANCE } from '@/data/balance'
import type { SoundEvent } from '@/data/sounds'
import { joinRoom, type ClientHandlers, type ClientSession } from '@/net/client'
import { startHost, type HostSession } from '@/net/host'
import { createPropViewer } from '@/render/prop-view'
import { preloadPartModels } from '@/render/models'
import { createView } from '@/render/scene'
import { createSmoother } from '@/render/smooth'
import { createSnakeViewer } from '@/render/snake-view'
import type { RenderState } from '@/render/state'
import { tickWorld } from '@/sim/tick'
import type { World } from '@/sim/types'
import { createWorld, playerSnakes } from '@/sim/world'
import { createHud } from '@/ui/hud'
import { createInput } from '@/ui/input'
import { createNameTags } from '@/ui/name-tags'

type Mode = 'idle' | 'local' | 'host' | 'guest'

const STEP = 1 / BALANCE.tickRate

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) {
  throw new Error('missing #game canvas')
}

const view = createView(canvas)
const snakeViewer = createSnakeViewer(view.scene)
const propViewer = createPropViewer(view.scene)
const smoother = createSmoother()
const input = createInput()
const nameTags = createNameTags()

// Art loads in the background; matches still start on placeholder primitives.
preloadPartModels()

let mode: Mode = 'idle'
let world: World | undefined
let host: HostSession | undefined
let client: ClientSession | undefined
let renderState: RenderState | undefined
/** Seconds since the last guest snapshot, used to blend between snapshots. */
let snapshotAge = 0
let playerId = 'you'
let playerName = ''
let resultsShown = false
let focusX = 0
let focusZ = 0

const hud = createHud({
  onLocal: startLocal,
  onCreate: (name) => {
    void createRoom(name)
  },
  onJoin: (code, name) => {
    void joinMatch(code, name)
  },
  onStart: () => host?.start(),
  onCancel: leaveToMenu,
  onAgain: () => {
    if (mode === 'host' && host) {
      host.start()
    } else {
      startLocal()
    }
  },
})

function randomSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

/** Only the effects of the own snake are audible. */
function playOwned(sound: SoundEvent): void {
  if (sound.by === playerId) {
    playSound(sound.name)
  }
}

/** Drops the last round's visuals, so a rematch that reuses ids starts clean. */
function resetRound(): void {
  snakeViewer.reset()
  smoother.reset()
  snapshotAge = 0
}

function resetSession(): void {
  host?.dispose()
  host = undefined
  client?.dispose()
  client = undefined
  world = undefined
  renderState = undefined
  resetRound()
  resultsShown = false
  mode = 'idle'
  nameTags.clear()
}

function showResults(rows: { name: string; score: number }[], canRestart: boolean): void {
  resultsShown = true
  hud.showResults(rows, canRestart)
  playSound(rows[0]?.name === playerName ? 'win' : 'lose')
}

function startLocal(): void {
  resetSession()
  playerName = hud.getPlayerName()
  world = createWorld({
    seed: randomSeed(),
    arena: classicArena,
    players: [
      {
        id: 'you',
        name: playerName,
        control: 'human',
        slot: 0,
        headId: DEFAULT_HEAD_ID,
      },
    ],
  })
  playerId = 'you'
  mode = 'local'
  renderState = world
  resultsShown = false
  hud.showGame()
}

async function createRoom(name: string): Promise<void> {
  resetSession()
  playerName = name
  try {
    const session = await startHost({
      playerName: name,
      handlers: {
        onLobby: (code, players) => hud.showLobby(code, players, true),
        onStart: () => {
          resetRound()
          mode = 'host'
          resultsShown = false
          hud.showGame()
        },
        onResults: (rows) => showResults(rows, true),
        onError: (message) => hud.flash(message),
        onClosed: () => {
          resetSession()
          hud.showMenu()
        },
      },
    })
    host = session
    playerId = 'host'
    mode = 'host'
    hud.showLobby(session.code, [{ id: 'host', name }], true)
  } catch (error) {
    hud.flash(toMessage(error))
    hud.showMenu()
  }
}

async function joinMatch(code: string, name: string): Promise<void> {
  const roomCode = code.trim().toLowerCase()
  if (!roomCode) {
    hud.flash('Enter a room code.')
    return
  }
  resetSession()
  playerName = name
  const handlers: ClientHandlers = {
    onLobby: (players) => hud.showLobby(roomCode, players, false),
    onStart: () => {
      resetRound()
      renderState = undefined
      mode = 'guest'
      resultsShown = false
      hud.showGame()
    },
    onSnapshot: (state) => {
      if (renderState) {
        smoother.capture(renderState)
      }
      renderState = state
      snapshotAge = 0
    },
    onSound: (name) => playSound(name),
    onResults: (rows) => showResults(rows, false),
    onError: (message) => hud.flash(message),
    onClosed: (message) => {
      hud.flash(message)
      resetSession()
      hud.showMenu()
    },
  }
  try {
    const session = await joinRoom({ roomCode, playerName: name, handlers })
    client = session
    playerId = session.playerId
    mode = 'guest'
  } catch (error) {
    hud.flash(toMessage(error))
    resetSession()
    hud.showMenu()
  }
}

function leaveToMenu(): void {
  resetSession()
  hud.showMenu()
}

function updateFocus(state: RenderState): void {
  const snake = state.snakes.find((candidate) => candidate.id === playerId)
  const head = snake?.segments[0]
  if (head) {
    focusX = head.x
    focusZ = head.z
  }
}

hud.showMenu()

startLoop({
  step: STEP,
  update: () => {
    const move = input.read()

    if (mode === 'local' && world) {
      const human = world.snakes.find((snake) => snake.id === 'you')
      if (human && human.alive) {
        human.steerX = move.x
        human.steerZ = move.z
      }
      smoother.capture(world)
      if (!world.ended) {
        tickWorld(world, STEP)
        for (const event of world.events) {
          for (const sound of soundsForEvent(event)) {
            playOwned(sound)
          }
        }
      } else if (!resultsShown) {
        showResults(
          playerSnakes(world).map((snake) => ({ name: snake.name, score: snake.score })),
          true,
        )
      }
      return
    }

    if (mode === 'host' && host) {
      host.setInput(move.x, move.z)
      const hostState = host.getState()
      if (hostState) {
        smoother.capture(hostState)
      }
      host.update(STEP)
      for (const sound of host.drainSounds()) {
        playOwned(sound)
      }
      return
    }

    if (mode === 'guest' && client) {
      client.sendInput(move.x, move.z)
    }
  },
  render: (dt, alpha) => {
    if (mode === 'local' && world) {
      renderState = world
    } else if (mode === 'host' && host) {
      renderState = host.getState()
    }

    if (renderState) {
      let blend = alpha
      if (mode === 'guest') {
        // Snapshots arrive slower than frames, so blend over the gap between two.
        snapshotAge += dt
        blend = snapshotAge * BALANCE.snapshotRate
      }
      const shown = smoother.sample(renderState, blend)
      snakeViewer.sync(shown, dt)
      propViewer.sync(shown, dt)
      updateFocus(shown)
      view.updateCamera(focusX, focusZ, dt)
      if (mode !== 'idle') {
        hud.update(renderState, playerId)
        nameTags.sync(shown, view.camera, playerId)
      }
    }
    view.render()
  },
})

window.addEventListener('beforeunload', () => {
  input.dispose()
  resetSession()
})
