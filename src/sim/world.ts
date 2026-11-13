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
  /** Human players in slot order. Missing slots are filled with bots. */
  players?: readonly PlayerSetup[]
}

export function createWorld({ seed, arena, players = [] }: WorldOptions): World {
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
  while (setups.length < BALANCE.maxPlayers) {
    const slot = setups.length
    setups.push({
      id: `bot-${slot + 1}`,
      name: `Bot ${slot + 1}`,
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
