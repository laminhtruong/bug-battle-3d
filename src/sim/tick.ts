import { requirePart } from '@/content'
import { BALANCE } from '@/data/balance'
import { updateAi } from './ai'
import { fireAttacks, updateAreas, updateContact, updateProjectiles } from './combat'
import { countApples, countEnemies, respawnSnake, spawnApple, spawnEnemy } from './spawn'
import { growSnake, healSnake, segmentRadius, updateMovement } from './snake'
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
  // Picking up a head brings a lost head back, like in the original.
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
    let taken = false
    for (const snake of world.snakes) {
      if (!snake.alive) {
        continue
      }
      const reach = BALANCE.pickupRadius + segmentRadius(0)
      if (Math.hypot(snake.x - pickup.x, snake.z - pickup.z) > reach) {
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
    if (!snake.alive && snake.control !== 'enemy' && world.time >= snake.respawnAt) {
      respawnSnake(world, snake)
    }
  }
  world.snakes = world.snakes.filter((snake) => snake.control !== 'enemy' || snake.alive)
}

function updateEnemySpawns(world: World): void {
  for (let index = world.enemyRespawns.length - 1; index >= 0; index -= 1) {
    const respawnAt = world.enemyRespawns[index]
    if (respawnAt === undefined || world.time < respawnAt) {
      continue
    }
    world.enemyRespawns.splice(index, 1)
    if (countEnemies(world) < world.arena.enemyCap) {
      spawnEnemy(world)
    }
  }
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
  for (const snake of world.snakes) {
    if (!snake.alive) {
      continue
    }
    if (snake.control !== 'human') {
      updateAi(world, snake)
    }
    updateMovement(snake, halfWidth, halfDepth, dt)
  }

  updateRespawns(world)
  fireAttacks(world, dt)
  updateProjectiles(world, dt)
  updateAreas(world, dt)
  updateContact(world)
  collectPickups(world)
  updateEnemySpawns(world)
  updateAppleSpawns(world)
}
