import './style.css'
import { startLoop } from '@/core/loop'
import { DEFAULT_HEAD_ID, classicArena } from '@/content'
import { BALANCE } from '@/data/balance'
import { joinRoom, type ClientHandlers, type ClientSession } from '@/net/client'
import { startHost, type HostSession } from '@/net/host'
import { createPropViewer } from '@/render/prop-view'
import { preloadPartModels } from '@/render/models'
import { createView } from '@/render/scene'
import { createSnakeViewer } from '@/render/snake-view'
import type { RenderState } from '@/render/state'
import { tickWorld } from '@/sim/tick'
import type { World } from '@/sim/types'
import { createWorld, playerSnakes } from '@/sim/world'
import { createHud } from '@/ui/hud'
import { createInput } from '@/ui/input'

type Mode = 'idle' | 'local' | 'host' | 'guest'

const STEP = 1 / BALANCE.tickRate

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) {
  throw new Error('missing #game canvas')
}

const view = createView(canvas)
const snakeViewer = createSnakeViewer(view.scene)
const propViewer = createPropViewer(view.scene)
const input = createInput()

// Art loads in the background; matches still start on placeholder primitives.
preloadPartModels()

let mode: Mode = 'idle'
let world: World | undefined
let host: HostSession | undefined
let client: ClientSession | undefined
let renderState: RenderState | undefined
let playerId = 'you'
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

function resetSession(): void {
  host?.dispose()
  host = undefined
  client?.dispose()
  client = undefined
  world = undefined
  renderState = undefined
  resultsShown = false
  mode = 'idle'
}

function showResults(rows: { name: string; score: number }[], canRestart: boolean): void {
  resultsShown = true
  hud.showResults(rows, canRestart)
}

function startLocal(): void {
  resetSession()
  world = createWorld({
    seed: randomSeed(),
    arena: classicArena,
    players: [
      {
        id: 'you',
        name: hud.getPlayerName(),
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
  try {
    const session = await startHost({
      playerName: name,
      handlers: {
        onLobby: (code, players) => hud.showLobby(code, players, true),
        onStart: () => {
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
  const handlers: ClientHandlers = {
    onLobby: (players) => hud.showLobby(roomCode, players, false),
    onStart: () => {
      mode = 'guest'
      resultsShown = false
      hud.showGame()
    },
    onSnapshot: (state) => {
      renderState = state
    },
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
      if (!world.ended) {
        tickWorld(world, STEP)
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
      host.update(STEP)
      return
    }

    if (mode === 'guest' && client) {
      client.sendInput(move.x, move.z)
    }
  },
  render: (dt) => {
    if (mode === 'local' && world) {
      renderState = world
    } else if (mode === 'host' && host) {
      renderState = host.getState()
    }

    if (renderState) {
      snakeViewer.sync(renderState)
      propViewer.sync(renderState)
      updateFocus(renderState)
      view.updateCamera(focusX, focusZ, dt)
      if (mode !== 'idle') {
        hud.update(renderState, playerId)
      }
    }
    view.render()
  },
})

window.addEventListener('beforeunload', () => {
  input.dispose()
  resetSession()
})
