import { normalize } from '@/core/math2d'
import type { Snake, World } from './types'

const AGGRO_RANGE = 10
const WANDER_MARGIN = 4
const RETARGET_MIN_SEC = 3
const RETARGET_MAX_SEC = 5

function steerTo(snake: Snake, x: number, z: number): void {
  const direction = normalize(x - snake.x, z - snake.z)
  snake.steerX = direction.x
  snake.steerZ = direction.z
}

function pickWanderTarget(world: World, snake: Snake): void {
  const { width, depth } = world.arena
  snake.ai.targetX = world.rng.range(-width / 2 + WANDER_MARGIN, width / 2 - WANDER_MARGIN)
  snake.ai.targetZ = world.rng.range(-depth / 2 + WANDER_MARGIN, depth / 2 - WANDER_MARGIN)
  snake.ai.retargetAt = world.time + world.rng.range(RETARGET_MIN_SEC, RETARGET_MAX_SEC)
}

function updateWander(world: World, snake: Snake): void {
  const reached = Math.hypot(snake.ai.targetX - snake.x, snake.ai.targetZ - snake.z) < 1
  if (reached || world.time >= snake.ai.retargetAt) {
    pickWanderTarget(world, snake)
  }
  steerTo(snake, snake.ai.targetX, snake.ai.targetZ)
}

function nearestPrey(world: World, snake: Snake): Snake | undefined {
  let nearest: Snake | undefined
  let nearestDistance = AGGRO_RANGE
  for (const other of world.snakes) {
    if (!other.alive || other.control === 'enemy') {
      continue
    }
    const distance = Math.hypot(other.x - snake.x, other.z - snake.z)
    if (distance < nearestDistance) {
      nearest = other
      nearestDistance = distance
    }
  }
  return nearest
}

function updateEnemy(world: World, snake: Snake): void {
  const prey = nearestPrey(world, snake)
  if (prey) {
    steerTo(snake, prey.x, prey.z)
    return
  }
  updateWander(world, snake)
}

function nearestApple(world: World, snake: Snake): { x: number; z: number } | undefined {
  let nearest: { x: number; z: number } | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const pickup of world.pickups) {
    if (pickup.kind !== 'apple') {
      continue
    }
    const distance = Math.hypot(pickup.x - snake.x, pickup.z - snake.z)
    if (distance < nearestDistance) {
      nearest = pickup
      nearestDistance = distance
    }
  }
  return nearest
}

function updateBot(world: World, snake: Snake): void {
  const apple = nearestApple(world, snake)
  if (apple) {
    steerTo(snake, apple.x, apple.z)
    return
  }
  updateWander(world, snake)
}

/** Bots and enemies share the same steering interface as remote players. */
export function updateAi(world: World, snake: Snake): void {
  if (snake.control === 'enemy') {
    updateEnemy(world, snake)
  } else {
    updateBot(world, snake)
  }
}
