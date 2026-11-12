import './style.css'
import { startLoop } from '@/core/loop'
import { DEFAULT_HEAD_ID, classicArena } from '@/content'
import { BALANCE } from '@/data/balance'
import { EN } from '@/i18n/en'
import { createPropViewer } from '@/render/prop-view'
import { createView } from '@/render/scene'
import { createSnakeViewer } from '@/render/snake-view'
import { tickWorld } from '@/sim/tick'
import type { Snake, World } from '@/sim/types'
import { createWorld, playerSnakes } from '@/sim/world'
import { createHud } from '@/ui/hud'
import { createInput } from '@/ui/input'

const canvas = document.querySelector<HTMLCanvasElement>('#game')
if (!canvas) {
  throw new Error('missing #game canvas')
}

const view = createView(canvas)
const snakeViewer = createSnakeViewer(view.scene)
const propViewer = createPropViewer(view.scene)
const input = createInput()

let world: World | undefined
let human: Snake | undefined
let resultsShown = false

const hud = createHud({ onPlay: startMatch, onPlayAgain: startMatch })

function startMatch(): void {
  world = createWorld({
    seed: (Date.now() ^ Math.floor(Math.random() * 0xffff_ffff)) >>> 0,
    arena: classicArena,
    players: [
      {
        id: 'you',
        name: EN.you,
        control: 'human',
        slot: 0,
        headId: DEFAULT_HEAD_ID,
      },
    ],
  })
  human = world.snakes.find((snake) => snake.control === 'human')
  resultsShown = false
  hud.showGame()
}

hud.showMenu()

startLoop({
  step: 1 / BALANCE.tickRate,
  update: () => {
    if (!world) {
      return
    }
    if (world.ended) {
      if (!resultsShown) {
        resultsShown = true
        hud.showResults(
          playerSnakes(world).map((snake) => ({ name: snake.name, score: snake.score })),
        )
      }
      return
    }
    if (human) {
      const move = input.read()
      human.steerX = move.x
      human.steerZ = move.z
    }
    tickWorld(world, 1 / BALANCE.tickRate)
  },
  render: (dt) => {
    if (world) {
      snakeViewer.sync(world)
      propViewer.sync(world)
      const focus = human ?? { x: 0, z: 0 }
      view.updateCamera(focus.x, focus.z, dt)
      hud.update(world, 'you')
    }
    view.render()
  },
})

window.addEventListener('beforeunload', () => {
  input.dispose()
})
