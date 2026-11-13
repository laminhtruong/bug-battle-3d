import { normalize } from '@/core/math2d'
import { isPlayerControl } from './types'
import type { Pickup, Snake, World } from './types'

const WANDER_MARGIN = 16
const RETARGET_MIN_SEC = 3
const RETARGET_MAX_SEC = 5
/** Bots grab parts before apples, and only look this far for each. */
const BOT_GEAR_RANGE = 40
const BOT_POWERUP_RANGE = 45
/** A ranged boss lines up its shot once its attack is this close to ready. */
const BOSS_AIM_COOLDOWN = 0.35
/** Closer than this the boss stops flanking and attacks. */
const BOSS_FLANK_RANGE = 10

/** Pushes the steering away from the walls so targets near an edge stay reachable. */
function steerAway(world: World, snake: Snake, x: number, z: number): void {
  const margin = 18
  const halfWidth = world.arena.width / 2 - margin
  const halfDepth = world.arena.depth / 2 - margin
  let pushX = 0
  let pushZ = 0
  if (snake.x > halfWidth) {
    pushX = -(snake.x - halfWidth) / margin
  } else if (snake.x < -halfWidth) {
    pushX = (-halfWidth - snake.x) / margin
  }
  if (snake.z > halfDepth) {
    pushZ = -(snake.z - halfDepth) / margin
  } else if (snake.z < -halfDepth) {
    pushZ = (-halfDepth - snake.z) / margin
  }
  const aim = normalize(x - snake.x, z - snake.z)
  const mixed = normalize(aim.x + pushX * 1.5, aim.z + pushZ * 1.5)
  snake.steerX = mixed.x
  snake.steerZ = mixed.z
}

function pickWanderTarget(world: World, snake: Snake): void {
  const { width, depth } = world.arena
  snake.ai.targetX = world.rng.range(-width / 2 + WANDER_MARGIN, width / 2 - WANDER_MARGIN)
  snake.ai.targetZ = world.rng.range(-depth / 2 + WANDER_MARGIN, depth / 2 - WANDER_MARGIN)
  snake.ai.retargetAt = world.time + world.rng.range(RETARGET_MIN_SEC, RETARGET_MAX_SEC)
}

function updateWander(world: World, snake: Snake): void {
  const reached = Math.hypot(snake.ai.targetX - snake.x, snake.ai.targetZ - snake.z) < 4
  if (reached || world.time >= snake.ai.retargetAt) {
    pickWanderTarget(world, snake)
  }
  steerAway(world, snake, snake.ai.targetX, snake.ai.targetZ)
}

function nearestPickup(
  world: World,
  snake: Snake,
  range: number,
  kinds: readonly Pickup['kind'][],
): Pickup | undefined {
  let nearest: Pickup | undefined
  let nearestDistance = range
  for (const pickup of world.pickups) {
    if (!kinds.includes(pickup.kind)) {
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

function nearestPowerup(world: World, snake: Snake, range: number): Snake | undefined {
  let nearest: Snake | undefined
  let nearestDistance = range
  for (const candidate of world.snakes) {
    if (!candidate.alive || candidate.control !== 'powerup') {
      continue
    }
    const distance = Math.hypot(candidate.x - snake.x, candidate.z - snake.z)
    if (distance < nearestDistance) {
      nearest = candidate
      nearestDistance = distance
    }
  }
  return nearest
}

/**
 * Bots gear up before they eat: part drops and power-ups are worth more than an
 * apple, and they only chase an apple when there is nothing better nearby.
 */
function updateBot(world: World, snake: Snake): void {
  const gear = nearestPickup(world, snake, BOT_GEAR_RANGE, ['head', 'body', 'heal'])
  if (gear) {
    steerAway(world, snake, gear.x, gear.z)
    return
  }
  const powerup = nearestPowerup(world, snake, BOT_POWERUP_RANGE)
  if (powerup) {
    steerAway(world, snake, powerup.x, powerup.z)
    return
  }
  const apple = nearestPickup(world, snake, BOT_GEAR_RANGE, ['apple'])
  if (apple) {
    steerAway(world, snake, apple.x, apple.z)
    return
  }
  updateWander(world, snake)
}

function livingHp(snake: Snake): number {
  return snake.segments.reduce((sum, segment) => (segment.dead ? sum : sum + segment.hp), 0)
}

/** The boss hunts the weakest player, not merely the closest one. */
function pickBossTarget(world: World, boss: Snake): Snake | undefined {
  let target: Snake | undefined
  let lowestHp = Number.POSITIVE_INFINITY
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const candidate of world.snakes) {
    if (!candidate.alive || candidate.id === boss.id || !isPlayerControl(candidate.control)) {
      continue
    }
    const hp = livingHp(candidate)
    const distance = Math.hypot(candidate.x - boss.x, candidate.z - boss.z)
    if (hp < lowestHp || (hp === lowestHp && distance < nearestDistance)) {
      target = candidate
      lowestHp = hp
      nearestDistance = distance
    }
  }
  return target
}

function bossPhase(boss: Snake): number {
  const digits = Number.parseInt(boss.id.replace(/\D/g, ''), 10)
  return Number.isFinite(digits) ? digits : 0
}

/**
 * The boss leads its target and weaves to a flank while its attack reloads.
 * Once the attack is ready it lines up, so it is not a straight chase.
 */
function updateBoss(world: World, boss: Snake): void {
  const target = pickBossTarget(world, boss)
  if (!target) {
    updateWander(world, boss)
    return
  }

  const distance = Math.hypot(target.x - boss.x, target.z - boss.z)
  const lead = Math.min(1, distance / Math.max(1, boss.speed))
  const predictedX = target.x + Math.sin(target.angle) * target.speed * lead * 0.35
  const predictedZ = target.z + Math.cos(target.angle) * target.speed * lead * 0.35
  const head = boss.segments[0]
  const linedUp = head !== undefined && !head.dead && head.cooldown <= BOSS_AIM_COOLDOWN

  let aimX = predictedX
  let aimZ = predictedZ
  if (!linedUp && distance > BOSS_FLANK_RANGE) {
    const direction = normalize(predictedX - boss.x, predictedZ - boss.z)
    const side = Math.sin(world.time * 0.9 + bossPhase(boss)) * Math.min(16, distance * 0.5)
    aimX += -direction.z * side
    aimZ += direction.x * side
  }

  boss.ai.targetX = aimX
  boss.ai.targetZ = aimZ
  steerAway(world, boss, aimX, aimZ)
}

/** Bots and bosses share the same steering interface as remote players. */
export function updateAi(world: World, snake: Snake): void {
  if (snake.control === 'boss') {
    updateBoss(world, snake)
  } else if (snake.control === 'bot') {
    updateBot(world, snake)
  }
}
