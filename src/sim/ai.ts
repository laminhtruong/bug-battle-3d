import { normalize } from '@/core/math2d'
import { isPlayerControl } from './types'
import type { Pickup, Snake, World } from './types'

const WANDER_MARGIN = 16
const RETARGET_MIN_SEC = 3
const RETARGET_MAX_SEC = 5
/** Bots grab parts before apples, and only look this far for each. */
const BOT_GEAR_RANGE = 40
const BOT_POWERUP_RANGE = 45
/** A bot chases a nearby player for a short run, then leaves it alone for a while. */
const BOT_CHASE_RANGE = 22
const BOT_CHASE_SEC = 3
const BOT_CHASE_REST_SEC = 4
/** The bot keeps the chase while the prey stays this close. */
const BOT_CHASE_LEASH = 30
/** The boss looks further and keeps chasing, unlike a bot. */
const BOSS_AGGRO_RANGE = 40
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
 * A player that walks close is chased for a short run, then ignored for a rest.
 */
function updateBot(world: World, bot: Snake): void {
  const now = world.time
  const chasing = now < bot.ai.chaseUntil
  const prey = chasing ? nearestPlayer(world, bot, BOT_CHASE_LEASH) : undefined
  if (prey) {
    steerAway(world, bot, prey.x, prey.z)
    return
  }
  if (chasing) {
    // Ran out of prey mid-chase, so start the rest cooldown from here.
    bot.ai.chaseUntil = now
    bot.ai.chaseRestUntil = now + BOT_CHASE_REST_SEC
  }
  if (now >= bot.ai.chaseRestUntil) {
    const target = nearestPlayer(world, bot, BOT_CHASE_RANGE)
    if (target) {
      bot.ai.chaseUntil = now + BOT_CHASE_SEC
      bot.ai.chaseRestUntil = bot.ai.chaseUntil + BOT_CHASE_REST_SEC
      steerAway(world, bot, target.x, target.z)
      return
    }
  }
  const gear = nearestPickup(world, bot, BOT_GEAR_RANGE, ['head', 'body', 'heal'])
  if (gear) {
    steerAway(world, bot, gear.x, gear.z)
    return
  }
  const powerup = nearestPowerup(world, bot, BOT_POWERUP_RANGE)
  if (powerup) {
    steerAway(world, bot, powerup.x, powerup.z)
    return
  }
  const apple = nearestPickup(world, bot, BOT_GEAR_RANGE, ['apple'])
  if (apple) {
    steerAway(world, bot, apple.x, apple.z)
    return
  }
  updateWander(world, bot)
}

function bossPhase(boss: Snake): number {
  const digits = Number.parseInt(boss.id.replace(/\D/g, ''), 10)
  return Number.isFinite(digits) ? digits : 0
}

/** Aims where the target will be after the attacker can close the gap. */
function leadPoint(snake: Snake, target: Snake): { x: number; z: number; distance: number } {
  const distance = Math.hypot(target.x - snake.x, target.z - snake.z)
  const lead = Math.min(1, distance / Math.max(1, snake.speed))
  return {
    x: target.x + Math.sin(target.angle) * target.speed * lead * 0.35,
    z: target.z + Math.cos(target.angle) * target.speed * lead * 0.35,
    distance,
  }
}

function nearestPlayer(world: World, snake: Snake, range: number): Snake | undefined {
  let nearest: Snake | undefined
  let nearestDistance = range
  for (const candidate of world.snakes) {
    if (!candidate.alive || candidate.id === snake.id || !isPlayerControl(candidate.control)) {
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
 * The boss leads its target and weaves to a flank while its attack reloads.
 * It wanders until a player comes close, then keeps the chase for as long as
 * the target stays near.
 */
function updateBoss(world: World, boss: Snake): void {
  const target = nearestPlayer(world, boss, BOSS_AGGRO_RANGE)
  if (!target) {
    updateWander(world, boss)
    return
  }

  const aim = leadPoint(boss, target)
  const head = boss.segments[0]
  const linedUp = head !== undefined && !head.dead && head.cooldown <= BOSS_AIM_COOLDOWN

  let aimX = aim.x
  let aimZ = aim.z
  if (!linedUp && aim.distance > BOSS_FLANK_RANGE) {
    const direction = normalize(aim.x - boss.x, aim.z - boss.z)
    const side = Math.sin(world.time * 0.9 + bossPhase(boss)) * Math.min(16, aim.distance * 0.5)
    aimX += -direction.z * side
    aimZ += direction.x * side
  }

  boss.ai.targetX = aimX
  boss.ai.targetZ = aimZ
  steerAway(world, boss, aimX, aimZ)
}

/** Bots and bosses steer themselves; wandering bugs only roam, like the original. */
export function updateAi(world: World, snake: Snake): void {
  if (snake.control === 'boss') {
    updateBoss(world, snake)
  } else if (snake.control === 'bot') {
    updateBot(world, snake)
  } else if (snake.control === 'enemy') {
    updateWander(world, snake)
  }
}
