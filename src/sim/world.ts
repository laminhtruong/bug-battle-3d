import type { ArenaDef } from '@/content/arena'
import { DEFAULT_HEAD_ID } from '@/content'
import { createRng } from '@/core/rng'
import { BALANCE } from '@/data/balance'
import {
  countApples,
  countEnemies,
  countPowerups,
  createPlayerSnake,
  spawnApple,
  spawnEnemy,
  spawnPowerup,
} from './spawn'
import type { PlayerSetup } from './spawn'
import { isPlayerControl } from './types'
import type { World } from './types'

export interface WorldOptions {
  seed: number
  arena: ArenaDef
  /** Human players in slot order. Missing slots are filled with bots by default. */
  players?: readonly PlayerSetup[]
  /** Fill unused player slots with bots. Off for online matches. */
  bots?: boolean
}

/** Bots get real-sounding names, so the arena does not show "Bot 2". */
const BOT_NAMES = [
  'Amber',
  'Bolt',
  'Bramble',
  'Coco',
  'Dash',
  'Ember',
  'Fizz',
  'Gizmo',
  'Hazel',
  'Juno',
  'Milo',
  'Nova',
  'Pebble',
  'Pixel',
  'Rocco',
  'Rusty',
  'Skipper',
  'Tango',
  'Waffles',
  'Ziggy',
]

export function createWorld({ seed, arena, players = [], bots = true }: WorldOptions): World {
  const world: World = {
    arena,
    rng: createRng(seed),
    tick: 0,
    time: 0,
    duration: arena.durationSec,
    ended: false,
    snakes: [],
    projectiles: [],
    areas: [],
    pickups: [],
    events: [],
    bossSpawnAt: arena.bossEverySec,
    enemySpawnAt: 0,
    powerupSpawnAt: 0,
    appleSpawnAt: 0,
    nextId: 0,
  }

  const setups: PlayerSetup[] = [...players]
  const botNames = [...BOT_NAMES]
  while (bots && setups.length < BALANCE.maxPlayers) {
    const slot = setups.length
    const name = botNames.splice(world.rng.int(0, botNames.length), 1)[0] ?? `Bug ${slot + 1}`
    setups.push({
      id: `bot-${slot + 1}`,
      name,
      control: 'bot',
      slot,
      headId: DEFAULT_HEAD_ID,
    })
  }

  for (const setup of setups) {
    createPlayerSnake(world, setup)
  }
  while (countEnemies(world) < arena.enemyCap) {
    spawnEnemy(world)
  }
  while (countPowerups(world) < arena.powerupTarget) {
    spawnPowerup(world)
  }
  while (countApples(world) < arena.appleTarget) {
    spawnApple(world)
  }

  return world
}

/** Living player snakes, sorted by slot. Used by the HUD and the results screen. */
export function playerSnakes(world: World): World['snakes'] {
  return world.snakes
    .filter((snake) => isPlayerControl(snake.control))
    .sort((a, b) => a.slot - b.slot)
}
