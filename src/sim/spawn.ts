import { BODIES, DEFAULT_BODY_ID, DEFAULT_HEAD_ID, HEADS, requirePart } from '@/content'
import { angleFromDirection, directionFromAngle, TAU } from '@/core/math2d'
import type { Vec2 } from '@/core/math2d'
import type { Rng } from '@/core/rng'
import { BALANCE } from '@/data/balance'
import { syncSegments, TRAIL_MAX_DISTANCE } from './snake'
import { isPlayerControl } from './types'
import type { Pickup, PickupKind, Segment, Snake, SnakeControl, World } from './types'

export interface PlayerSetup {
  id: string
  name: string
  control: 'human' | 'bot'
  slot: number
  headId: string
}

interface CreateSnakeInput {
  id: string
  name: string
  control: SnakeControl
  slot: number
  headId: string
  bodyIds: readonly string[]
  x: number
  z: number
  angle: number
  speed: number
}

export function nextEntityId(world: World, prefix: string): string {
  world.nextId += 1
  return `${prefix}-${world.nextId}`
}

function makeSegments(headId: string, bodyIds: readonly string[]): Segment[] {
  const entries: { slot: 'head' | 'body'; partId: string }[] = [
    { slot: 'head', partId: headId },
    ...bodyIds.map((partId) => ({ slot: 'body' as const, partId })),
  ]
  return entries.map(({ slot, partId }) => {
    const part = requirePart(slot, partId)
    return {
      partId,
      slot,
      hp: part.hp,
      maxHp: part.hp,
      dead: false,
      x: 0,
      z: 0,
      angle: 0,
      cooldown: part.attack?.cooldown ?? 0,
      hurtUntil: 0,
    }
  })
}

/** Lays a straight trail behind the head so the chain has something to sample. */
function fillTrail(snake: Snake): void {
  const direction = directionFromAngle(snake.angle)
  snake.trail.length = 0
  for (let distance = TRAIL_MAX_DISTANCE; distance > 0; distance -= 0.1) {
    snake.trail.push({
      x: snake.x - direction.x * distance,
      z: snake.z - direction.z * distance,
    })
  }
  snake.trail.push({ x: snake.x, z: snake.z })
}

function createSnake(world: World, input: CreateSnakeInput): Snake {
  const snake: Snake = {
    id: input.id,
    control: input.control,
    name: input.name,
    slot: input.slot,
    alive: true,
    respawnAt: 0,
    x: input.x,
    z: input.z,
    angle: input.angle,
    steerX: 0,
    steerZ: 0,
    trail: [],
    segments: [],
    food: 0,
    score: 0,
    kills: 0,
    speed: input.speed,
    ai: { targetX: input.x, targetZ: input.z, retargetAt: 0, chaseUntil: 0, chaseRestUntil: 0 },
    baseHeadId: input.headId,
  }
  fillTrail(snake)
  snake.segments = makeSegments(input.headId, input.bodyIds)
  syncSegments(snake)
  world.snakes.push(snake)
  return snake
}

/** Bots and wandering bugs roll gear up to the strongest part a human owns. */
function gearCap(world: World): number {
  let strongest = 0
  for (const snake of world.snakes) {
    if (!snake.alive || snake.control !== 'human') {
      continue
    }
    for (const segment of snake.segments) {
      if (!segment.dead) {
        strongest = Math.max(strongest, requirePart(segment.slot, segment.partId).score)
      }
    }
  }
  return strongest + BALANCE.botGearBonus
}

/** Random part ids, keeping the roll within the player's current power. */
function pickGearIds(
  world: World,
  slot: 'head' | 'body',
  pool: readonly string[],
  count: number,
): string[] {
  const cap = gearCap(world)
  const allowed = pool.filter((id) => requirePart(slot, id).score <= cap)
  const source = allowed.length > 0 ? allowed : pool
  return Array.from({ length: count }, () => world.rng.pick(source))
}

const HEAD_IDS = HEADS.map((part) => part.id)
const BODY_IDS = BODIES.map((part) => part.id)

export function createPlayerSnake(world: World, setup: PlayerSetup): Snake {
  const spawn = pickSpawnPoint(world)
  const bot = setup.control === 'bot'
  const bodyCount = BALANCE.food.startSegments - 1
  return createSnake(world, {
    ...setup,
    headId: bot ? pickGearIds(world, 'head', HEAD_IDS, 1)[0] ?? setup.headId : setup.headId,
    bodyIds: bot
      ? pickGearIds(world, 'body', BODY_IDS, bodyCount)
      : Array.from({ length: bodyCount }, () => DEFAULT_BODY_ID),
    x: spawn.x,
    z: spawn.z,
    angle: angleFromDirection(-spawn.x, -spawn.z),
    speed: BALANCE.playerSpeed,
  })
}

export function respawnSnake(world: World, snake: Snake): void {
  const spawn = pickSpawnPoint(world)
  snake.x = spawn.x
  snake.z = spawn.z
  snake.angle = angleFromDirection(-spawn.x, -spawn.z)
  snake.alive = true
  snake.food = 0
  snake.steerX = 0
  snake.steerZ = 0
  snake.ai.targetX = spawn.x
  snake.ai.targetZ = spawn.z
  snake.ai.retargetAt = world.time
  snake.ai.chaseUntil = 0
  snake.ai.chaseRestUntil = 0
  fillTrail(snake)
  const bot = snake.control === 'bot'
  const bodyCount = BALANCE.food.startSegments - 1
  if (bot) {
    snake.baseHeadId = pickGearIds(world, 'head', HEAD_IDS, 1)[0] ?? snake.baseHeadId
  }
  snake.segments = makeSegments(
    snake.baseHeadId,
    bot
      ? pickGearIds(world, 'body', BODY_IDS, bodyCount)
      : Array.from({ length: bodyCount }, () => DEFAULT_BODY_ID),
  )
  syncSegments(snake)
  world.events.push({ type: 'spawn', snakeId: snake.id, x: snake.x, z: snake.z })
}

export function randomPointInArena(rng: Rng, arena: World['arena'], margin = 8): Vec2 {
  return {
    x: rng.range(-arena.width / 2 + margin, arena.width / 2 - margin),
    z: rng.range(-arena.depth / 2 + margin, arena.depth / 2 - margin),
  }
}

/** Picks the arena spawn point farthest from every living player. */
export function pickSpawnPoint(world: World): Vec2 {
  let best: Vec2 = world.arena.spawns[0] ?? { x: 0, z: 0 }
  let bestDistance = -1
  for (const candidate of world.arena.spawns) {
    let nearest = Number.POSITIVE_INFINITY
    for (const snake of world.snakes) {
      if (!snake.alive || !isPlayerControl(snake.control)) {
        continue
      }
      nearest = Math.min(nearest, Math.hypot(candidate.x - snake.x, candidate.z - snake.z))
    }
    if (nearest > bestDistance) {
      bestDistance = nearest
      best = candidate
    }
  }
  return { x: best.x, z: best.z }
}

function isSafeMapSpawn(world: World, x: number, z: number, minDistance: number): boolean {
  for (const snake of world.snakes) {
    if (!snake.alive || !isPlayerControl(snake.control)) {
      continue
    }
    if (Math.hypot(snake.x - x, snake.z - z) < minDistance) {
      return false
    }
  }
  return true
}

function pickMapPoint(
  world: World,
  margin: number,
  minDistance: number,
  check?: (x: number, z: number) => boolean,
): Vec2 {
  let point = randomPointInArena(world.rng, world.arena, margin)
  for (let attempt = 0; attempt < 24; attempt += 1) {
    point = randomPointInArena(world.rng, world.arena, margin)
    if (
      isSafeMapSpawn(world, point.x, point.z, minDistance) &&
      (!check || check(point.x, point.z))
    ) {
      break
    }
  }
  return point
}

/** A wandering bug: it lives on the map and fights back when a player is close. */
export function spawnEnemy(world: World): void {
  const { arena, rng } = world
  const point = pickMapPoint(world, 12, BALANCE.enemySpawnMinDistance)
  const heads = arena.enemyHeads.length > 0 ? arena.enemyHeads : [DEFAULT_HEAD_ID]
  const bodies = arena.enemyBodies.length > 0 ? arena.enemyBodies : [DEFAULT_BODY_ID]

  createSnake(world, {
    id: nextEntityId(world, 'enemy'),
    name: 'Bug',
    control: 'enemy',
    slot: -1,
    headId: pickGearIds(world, 'head', heads, 1)[0] ?? DEFAULT_HEAD_ID,
    bodyIds: pickGearIds(world, 'body', bodies, BALANCE.food.startSegments - 1),
    x: point.x,
    z: point.z,
    angle: rng.range(-Math.PI, Math.PI),
    speed: BALANCE.enemySpeed,
  })
}

/** Heads without contact damage, so a power-up is a target, not a hazard. */
const POWERUP_HEADS = HEADS.filter((part) => part.contact.damage === 0)

/** Crates keep clear of each other, so two boxes never share a corner. */
function clearOfCrates(world: World, x: number, z: number): boolean {
  return world.snakes.every(
    (snake) =>
      snake.control !== 'powerup' ||
      !snake.alive ||
      Math.hypot(snake.x - x, snake.z - z) >= BALANCE.powerupSpacing,
  )
}

/**
 * Destructible loot target. It is a stationary one-part snake, so projectiles
 * and contact attacks damage it like any other bug.
 */
export function spawnPowerup(world: World): Snake {
  const { rng } = world
  const point = pickMapPoint(world, 12, BALANCE.powerupSpawnMinDistance, (x, z) =>
    clearOfCrates(world, x, z),
  )
  const snake = createSnake(world, {
    id: nextEntityId(world, 'powerup'),
    name: 'PowerUp',
    control: 'powerup',
    slot: -1,
    headId: rng.pick(POWERUP_HEADS.length > 0 ? POWERUP_HEADS : HEADS).id,
    bodyIds: [],
    x: point.x,
    z: point.z,
    // The crate keeps its prefab facing; a random angle would turn it away.
    angle: 0,
    speed: 0,
  })
  const head = snake.segments[0]
  if (head) {
    const hp = rng.int(BALANCE.powerupHpMin, BALANCE.powerupHpMax + 1)
    head.hp = hp
    head.maxHp = hp
  }
  return snake
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index + 1)
    const value = copy[index]!
    copy[index] = copy[swap]!
    copy[swap] = value
  }
  return copy
}

/** Fills the boss body with every pool type first, then random repeats. */
function bossBodyIds(world: World): string[] {
  const { arena, rng } = world
  const pool = arena.bossBodies.length > 0 ? arena.bossBodies : [DEFAULT_BODY_ID]
  const variety = shuffled(rng, pool)
  const bodyIds = variety.slice(0, arena.bossBodyCount)
  while (bodyIds.length < arena.bossBodyCount) {
    bodyIds.push(rng.pick(pool))
  }
  return bodyIds
}

export function spawnBoss(world: World): Snake {
  const { arena, rng } = world
  const point = pickMapPoint(world, 24, BALANCE.bossSpawnMinDistance)
  const heads = arena.bossHeads.length > 0 ? arena.bossHeads : [DEFAULT_HEAD_ID]
  const boss = createSnake(world, {
    id: nextEntityId(world, 'boss'),
    name: 'Boss',
    control: 'boss',
    slot: -1,
    headId: rng.pick(heads),
    bodyIds: bossBodyIds(world),
    x: point.x,
    z: point.z,
    angle: angleFromDirection(-point.x, -point.z),
    speed: BALANCE.bossSpeed,
  })
  world.events.push({ type: 'spawn', snakeId: boss.id, x: boss.x, z: boss.z })
  return boss
}

export function createPickup(
  world: World,
  kind: PickupKind,
  x: number,
  z: number,
  partId?: string,
): Pickup {
  const limitX = world.arena.width / 2 - 4
  const limitZ = world.arena.depth / 2 - 4
  const pickup: Pickup = {
    id: nextEntityId(world, 'pickup'),
    kind,
    x: Math.min(limitX, Math.max(-limitX, x)),
    z: Math.min(limitZ, Math.max(-limitZ, z)),
    expireAt: world.time + BALANCE.drops.ttlSec,
  }
  if (partId) {
    pickup.partId = partId
  }
  world.pickups.push(pickup)
  return pickup
}

export function spawnApple(world: World): void {
  const point = randomPointInArena(world.rng, world.arena, 8)
  createPickup(world, 'apple', point.x, point.z)
}

/** Drops part pickups, a heal and a few apples around a dead snake. */
export function spawnDrops(
  world: World,
  x: number,
  z: number,
  parts: readonly { slot: 'head' | 'body'; partId: string }[],
): void {
  const { rng } = world
  const jitter = (): number => rng.range(-6, 6)

  for (const { slot, partId } of parts) {
    if (slot === 'head') {
      if (rng.next() < BALANCE.drops.headChance) {
        createPickup(world, 'head', x + jitter(), z + jitter(), partId)
      }
    } else if (rng.next() < BALANCE.drops.bodyChance) {
      createPickup(world, 'body', x + jitter(), z + jitter(), partId)
    }
  }

  if (rng.next() < BALANCE.drops.healChance) {
    createPickup(world, 'heal', x + jitter(), z + jitter())
  }

  const apples = rng.int(BALANCE.drops.applesMin, BALANCE.drops.applesMax + 1)
  for (let index = 0; index < apples; index += 1) {
    createPickup(world, 'apple', x + jitter(), z + jitter())
  }
}

/** A broken crate throws three to five items up and out around it. */
export function spawnPowerupDrops(world: World, x: number, z: number): void {
  const { rng } = world
  const count = rng.int(BALANCE.powerupDropCountMin, BALANCE.powerupDropCountMax + 1)
  const landAt = world.time + BALANCE.powerupDropFlightSec
  for (let index = 0; index < count; index += 1) {
    const slot: 'head' | 'body' =
      rng.next() < BALANCE.powerupDropHeadChance ? 'head' : 'body'
    const partId = rng.pick(slot === 'head' ? HEADS : BODIES).id
    // One item per slice of the ring, so the loot spreads all around the crate.
    const angle = (index / count) * TAU + rng.range(0, TAU / count)
    const distance = rng.range(
      BALANCE.powerupDropMinDistance,
      BALANCE.powerupDropMaxDistance,
    )
    const drop = createPickup(
      world,
      slot,
      x + Math.sin(angle) * distance,
      z + Math.cos(angle) * distance,
      partId,
    )
    // The arc buys the player time to step away before the item can be taken.
    drop.fromX = x
    drop.fromZ = z
    drop.landAt = landAt
  }
}

/**
 * The boss drops exactly ten of its parts: its head plus nine of its ten
 * bodies, so the reward includes the good head it was using.
 */
export function spawnBossDrops(
  world: World,
  x: number,
  z: number,
  parts: readonly { slot: 'head' | 'body'; partId: string }[],
): void {
  const { rng } = world
  const loot = parts.filter((part) => part.slot === 'head').slice(0, 1)
  for (const part of parts) {
    if (loot.length >= BALANCE.bossLootCount) {
      break
    }
    if (part.slot === 'body') {
      loot.push(part)
    }
  }
  const jitter = (): number => rng.range(-8, 8)
  for (const part of loot) {
    createPickup(world, part.slot, x + jitter(), z + jitter(), part.partId)
  }
}

export function countPowerups(world: World): number {
  return world.snakes.filter((snake) => snake.control === 'powerup' && snake.alive).length
}

export function countEnemies(world: World): number {
  return world.snakes.filter((snake) => snake.control === 'enemy' && snake.alive).length
}

export function countApples(world: World): number {
  return world.pickups.filter((pickup) => pickup.kind === 'apple').length
}
