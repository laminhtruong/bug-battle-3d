import { requirePart } from '@/content'
import { BALANCE } from '@/data/balance'
import { updateAi } from './ai'
import { fireAttacks, updateAreas, updateContact, updateProjectiles } from './combat'
import {
  countApples,
  countEnemies,
  countPowerups,
  respawnSnake,
  spawnApple,
  spawnBoss,
  spawnEnemy,
  spawnPowerup,
} from './spawn'
import { segmentHitsCircle } from './collider'
import { growSnake, healSnake, updateMovement } from './snake'
import { isPlayerControl } from './types'
import type { Pickup, Snake, World } from './types'

function equipHead(snake: Snake, partId: string): void {
  const head = snake.segments[0]
  if (!head) {
    return
  }
  const part = requirePart('head', partId)
  head.partId = partId
  head.hp = part.hp
  head.maxHp = part.hp
  head.cooldown = part.attack?.cooldown ?? 0
  // Picking up a head brings a lost head back.
  head.dead = false
  snake.baseHeadId = partId
}

function collect(world: World, snake: Snake, pickup: Pickup): void {
  world.events.push({
    type: 'pickup',
    snakeId: snake.id,
    pickupId: pickup.id,
    kind: pickup.kind,
    x: pickup.x,
    z: pickup.z,
  })

  switch (pickup.kind) {
    case 'apple': {
      snake.score += BALANCE.food.scorePerApple
      snake.food += 1
      if (snake.food >= BALANCE.food.applesToGrow) {
        snake.food -= BALANCE.food.applesToGrow
        if (growSnake(snake)) {
          world.events.push({ type: 'growth', snakeId: snake.id })
        }
      }
      break
    }
    case 'body': {
      if (pickup.partId && growSnake(snake, pickup.partId)) {
        world.events.push({ type: 'growth', snakeId: snake.id })
      }
      break
    }
    case 'head': {
      if (pickup.partId) {
        equipHead(snake, pickup.partId)
      }
      break
    }
    case 'heal': {
      healSnake(snake)
      break
    }
  }
}

function collectPickups(world: World): void {
  const survivors: Pickup[] = []
  for (const pickup of world.pickups) {
    if (world.time >= pickup.expireAt) {
      continue
    }
    // Crate loot is airborne: it cannot be grabbed until it lands.
    if (pickup.landAt !== undefined && world.time < pickup.landAt) {
      survivors.push(pickup)
      continue
    }
    let taken = false
    for (const snake of world.snakes) {
      // The boss eats too, so it grows from the loot players leave around.
      if (!snake.alive || !(isPlayerControl(snake.control) || snake.control === 'boss')) {
        continue
      }
      const head = snake.segments[0]
      if (
        !head ||
        !segmentHitsCircle(
          requirePart(head.slot, head.partId),
          head,
          pickup.x,
          pickup.z,
          BALANCE.pickupRadius,
        )
      ) {
        continue
      }
      collect(world, snake, pickup)
      taken = true
      break
    }
    if (!taken) {
      survivors.push(pickup)
    }
  }
  world.pickups = survivors
}

function updateRespawns(world: World): void {
  for (const snake of world.snakes) {
    if (isPlayerControl(snake.control) && !snake.alive && world.time >= snake.respawnAt) {
      respawnSnake(world, snake)
    }
  }
  // Map targets vanish on death; players stay in the list to respawn.
  world.snakes = world.snakes.filter(
    (snake) => isPlayerControl(snake.control) || snake.alive,
  )
}

function updateBossSpawn(world: World): void {
  if (world.time < world.bossSpawnAt) {
    return
  }
  const bossAlive = world.snakes.some((snake) => snake.control === 'boss' && snake.alive)
  if (!bossAlive) {
    spawnBoss(world)
  }
  world.bossSpawnAt = world.time + world.arena.bossEverySec
}

function updateEnemySpawns(world: World): void {
  if (world.time < world.enemySpawnAt || countEnemies(world) >= world.arena.enemyCap) {
    return
  }
  spawnEnemy(world)
  world.enemySpawnAt = world.time + BALANCE.enemyRespawnSec
}

function updatePowerupSpawns(world: World): void {
  if (
    world.time < world.powerupSpawnAt ||
    countPowerups(world) >= world.arena.powerupTarget
  ) {
    return
  }
  spawnPowerup(world)
  world.powerupSpawnAt = world.time + BALANCE.powerupRespawnSec
}

function updateAppleSpawns(world: World): void {
  if (world.time < world.appleSpawnAt || countApples(world) >= world.arena.appleTarget) {
    return
  }
  spawnApple(world)
  world.appleSpawnAt = world.time + BALANCE.appleRespawnSec
}

/** Advances the simulation one fixed step. */
export function tickWorld(world: World, dt: number): void {
  world.events = []
  if (world.ended) {
    return
  }

  world.time += dt
  if (world.time >= world.duration) {
    world.time = world.duration
    world.ended = true
    world.events.push({ type: 'round-end' })
    return
  }
  world.tick += 1

  const halfWidth = world.arena.width / 2
  const halfDepth = world.arena.depth / 2
  const solids = world.snakes
    .filter((snake) => snake.alive && snake.control === 'powerup')
    .map((snake) => ({ x: snake.x, z: snake.z }))
  for (const snake of world.snakes) {
    if (!snake.alive || snake.control === 'powerup') {
      continue
    }
    if (snake.control !== 'human') {
      updateAi(world, snake)
    }
    updateMovement(snake, halfWidth, halfDepth, dt, solids)
  }

  updateRespawns(world)
  fireAttacks(world, dt)
  updateProjectiles(world, dt)
  updateAreas(world, dt)
  updateContact(world)
  collectPickups(world)
  updateBossSpawn(world)
  updateEnemySpawns(world)
  updatePowerupSpawns(world)
  updateAppleSpawns(world)
}
