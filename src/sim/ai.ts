import { angleFromDirection, normalize } from '@/core/math2d'
import { requirePart } from '@/content'
import { BALANCE } from '@/data/balance'
import { contactReach } from './collider'
import { canAttack, killSnake } from './combat'
import { isPlayerControl } from './types'
import type { Pickup, Segment, Snake, World } from './types'

const WANDER_MARGIN = 16
const RETARGET_MIN_SEC = 3
const RETARGET_MAX_SEC = 5
/** Bots grab parts before apples, and only look this far for each. */
const BOT_GEAR_RANGE = 40
const BOT_POWERUP_RANGE = 20
/** Bots shoot crates from this fraction of their attack reach. */
const BOT_SHOOT_REACH = 0.6
/** A player closer than this makes a bot drop its crate and run. */
const BOT_DANGER_RANGE = 12
/** A bot chases a nearby player for a short run, then leaves it alone for a while. */
const BOT_CHASE_RANGE = 22
const BOT_CHASE_SEC = 3
const BOT_CHASE_REST_SEC = 4
/** The bot keeps the chase while the prey stays this close. */
const BOT_CHASE_LEASH = 30
/** Bots see a moving target through a short reaction delay, not instantly. */
const BOT_REACT_RATE = 3.2
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
    // Do not walk up to a crate a human is camping: the bot would just bounce
    // back and forth around the danger radius instead of farming it.
    if (humanWithin(world, candidate.x, candidate.z, BOT_DANGER_RANGE)) {
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

/** True when a human player stands within range of a point. */
function humanWithin(world: World, x: number, z: number, range: number): boolean {
  for (const snake of world.snakes) {
    if (!snake.alive || snake.control !== 'human') {
      continue
    }
    if (Math.hypot(snake.x - x, snake.z - z) < range) {
      return true
    }
  }
  return false
}

/** The shooting part of the bot's reach for one segment, or 0 for a melee part. */
function segmentReach(segment: Segment | undefined): number {
  if (!segment || segment.dead) {
    return 0
  }
  const attack = requirePart(segment.slot, segment.partId).attack
  if (!attack) {
    return 0
  }
  const range =
    attack.kind === 'cone'
      ? attack.cone.range
      : attack.projectile.speed * attack.projectile.ttl
  return range * BOT_SHOOT_REACH
}

/** Farthest shot on the whole snake, so a headless bot with a gun body still shoots. */
function attackReach(snake: Snake): number {
  return Math.max(0, ...snake.segments.map(segmentReach))
}

/** Bots only farm crates with a ranged head; bosses may use body weapons too. */
function headReach(snake: Snake): number {
  return segmentReach(snake.segments[0])
}

/** Uses the same oriented-box geometry as contact damage. */
function meleeReach(bot: Snake, prey: Snake, x: number, z: number): number {
  const head = bot.segments[0]
  if (!head || head.dead) {
    return 0
  }
  const part = requirePart(head.slot, head.partId)
  if (part.contact.damage <= 0) {
    return 0
  }
  const direction = normalize(x - bot.x, z - bot.z)
  if (Math.hypot(direction.x, direction.z) < 1e-6) {
    return BOT_BITE_REACH
  }
  const targets = prey.segments.flatMap((segment) =>
    segment.dead ? [] : [{ part: requirePart(segment.slot, segment.partId), segment }],
  )
  return contactReach(
    { part, segment: { ...head, angle: angleFromDirection(direction.x, direction.z) } },
    { x: bot.x, z: bot.z },
    targets,
    { x: prey.x, z: prey.z },
    direction,
  )
}

function botAttackReach(bot: Snake, prey: Snake, x: number, z: number): number {
  const melee = meleeReach(bot, prey, x, z)
  return melee > 0
    ? Math.max(BOT_BITE_REACH, melee - BOT_CONTACT_OVERLAP)
    : Math.max(attackReach(bot), BOT_BITE_REACH)
}

/** Turns toward a point without travelling, so the head aims its attack. */
function faceOnly(snake: Snake, x: number, z: number): void {
  const direction = normalize(x - snake.x, z - snake.z)
  // The tiny push keeps the turn logic alive while the snake stands still.
  snake.steerX = direction.x * 0.001
  snake.steerZ = direction.z * 0.001
}

/** Moves the bot's mental image of its prey toward the real spot, at reaction speed. */
function trackPrey(bot: Snake, prey: Snake): void {
  const blend = 1 - Math.exp(-BOT_REACT_RATE / BALANCE.tickRate)
  bot.ai.seenX += (prey.x - bot.ai.seenX) * blend
  bot.ai.seenZ += (prey.z - bot.ai.seenZ) * blend
}

/** Fallback for a head without a usable contact hitbox. */
const BOT_BITE_REACH = 0.8
/** Stay inside the geometric contact boundary to absorb movement error. */
const BOT_CONTACT_OVERLAP = 0.4

/** Closes to attack range, then holds and aims instead of running through. */
function holdAtRange(world: World, bot: Snake, x: number, z: number, reach: number): void {
  const distance = Math.hypot(x - bot.x, z - bot.z)
  if (distance > reach) {
    steerAway(world, bot, x, z)
  } else {
    faceOnly(bot, x, z)
  }
}

/**
 * Bots gear up before they eat: part drops and power-ups are worth more than an
 * apple, and they only chase an apple when there is nothing better nearby.
 * A player that walks close is chased for a short run, then ignored for a rest.
 */
function updateBot(world: World, bot: Snake): void {
  const now = world.time
  const headless = bot.segments[0]?.dead === true
  if (headless && !canAttack(bot)) {
    killSnake(world, bot)
    return
  }
  const chasing = !headless && now < bot.ai.chaseUntil
  // Bots only take the bait from the human. Chasing each other turned into two
  // bots orbiting one spot, usually right next to the crate they were farming.
  const prey = chasing ? nearestPlayer(world, bot, BOT_CHASE_LEASH, true) : undefined
  if (prey) {
    trackPrey(bot, prey)
    holdAtRange(
      world,
      bot,
      bot.ai.seenX,
      bot.ai.seenZ,
      botAttackReach(bot, prey, bot.ai.seenX, bot.ai.seenZ),
    )
    return
  }
  if (chasing) {
    // Ran out of prey mid-chase, so start the rest cooldown from here.
    bot.ai.chaseUntil = now
    bot.ai.chaseRestUntil = now + BOT_CHASE_REST_SEC
  }
  if (now >= bot.ai.chaseRestUntil) {
    const target = nearestPlayer(world, bot, BOT_CHASE_RANGE, true)
    if (target) {
      bot.ai.chaseUntil = now + BOT_CHASE_SEC
      bot.ai.chaseRestUntil = bot.ai.chaseUntil + BOT_CHASE_REST_SEC
      // The bot locks on where the player is now, then trails behind the turn.
      bot.ai.seenX = target.x
      bot.ai.seenZ = target.z
      holdAtRange(world, bot, target.x, target.z, botAttackReach(bot, target, target.x, target.z))
      return
    }
  }
  const gear = nearestPickup(world, bot, BOT_GEAR_RANGE, ['head', 'body', 'heal'])
  if (gear) {
    steerAway(world, bot, gear.x, gear.z)
    return
  }
  // Only the head can aim at crates; body weapons are reserved for bosses here.
  const reach = headReach(bot)
  const powerup = reach > 0 ? nearestPowerup(world, bot, BOT_POWERUP_RANGE) : undefined
  if (powerup) {
    // Only a human scares a bot off a crate. Reacting to other bots made a
    // group farming one crate bounce around it forever.
    const threat = nearestPlayer(world, bot, BOT_DANGER_RANGE, true)
    if (threat) {
      // Back off from the threat instead of standing next to it.
      const dx = bot.x - threat.x
      const dz = bot.z - threat.z
      const length = Math.hypot(dx, dz) || 1
      steerAway(world, bot, bot.x + (dx / length) * 8, bot.z + (dz / length) * 8)
      return
    }
    const distance = Math.hypot(powerup.x - bot.x, powerup.z - bot.z)
    if (distance > reach) {
      steerAway(world, bot, powerup.x, powerup.z)
    } else {
      faceOnly(bot, powerup.x, powerup.z)
    }
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

function nearestPlayer(
  world: World,
  snake: Snake,
  range: number,
  humansOnly = false,
): Snake | undefined {
  let nearest: Snake | undefined
  let nearestDistance = range
  for (const candidate of world.snakes) {
    if (!candidate.alive || candidate.id === snake.id) {
      continue
    }
    if (humansOnly ? candidate.control !== 'human' : !isPlayerControl(candidate.control)) {
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
    const reach = attackReach(boss)
    const powerup = reach > 0 ? nearestPowerup(world, boss, BOSS_AGGRO_RANGE) : undefined
    if (powerup) {
      holdAtRange(world, boss, powerup.x, powerup.z, reach)
      return
    }
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
