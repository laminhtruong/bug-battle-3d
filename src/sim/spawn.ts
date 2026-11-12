import { DEFAULT_BODY_ID, DEFAULT_HEAD_ID, requirePart } from '@/content'
import { angleFromDirection, directionFromAngle } from '@/core/math2d'
import type { Vec2 } from '@/core/math2d'
import type { Rng } from '@/core/rng'
import { BALANCE } from '@/data/balance'
import { syncSegments, TRAIL_MAX_DISTANCE } from './snake'
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
    ai: { targetX: input.x, targetZ: input.z, retargetAt: 0 },
    baseHeadId: input.headId,
  }
  fillTrail(snake)
  snake.segments = makeSegments(input.headId, input.bodyIds)
  syncSegments(snake)
  world.snakes.push(snake)
  return snake
}

export function createPlayerSnake(world: World, setup: PlayerSetup): Snake {
  const spawn = pickSpawnPoint(world)
  const bodyIds = Array.from({ length: BALANCE.food.startSegments - 1 }, () => DEFAULT_BODY_ID)
  return createSnake(world, {
    ...setup,
    bodyIds,
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
  fillTrail(snake)
  snake.segments = makeSegments(
    snake.baseHeadId,
    Array.from({ length: BALANCE.food.startSegments - 1 }, () => DEFAULT_BODY_ID),
  )
  syncSegments(snake)
  world.events.push({ type: 'spawn', snakeId: snake.id, x: snake.x, z: snake.z })
}

export function randomPointInArena(rng: Rng, arena: World['arena'], margin = 2): Vec2 {
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
      if (!snake.alive || snake.control === 'enemy') {
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

function isSafeEnemySpawn(world: World, x: number, z: number): boolean {
  for (const snake of world.snakes) {
    if (!snake.alive || snake.control === 'enemy') {
      continue
    }
    if (Math.hypot(snake.x - x, snake.z - z) < BALANCE.enemySpawnMinDistance) {
      return false
    }
  }
  return true
}

export function spawnEnemy(world: World): void {
  const { arena, rng } = world
  let point = randomPointInArena(rng, arena, 3)
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomPointInArena(rng, arena, 3)
    point = candidate
    if (isSafeEnemySpawn(world, candidate.x, candidate.z)) {
      break
    }
  }

  const heads = arena.enemyHeads.length > 0 ? arena.enemyHeads : [DEFAULT_HEAD_ID]
  const bodies = arena.enemyBodies.length > 0 ? arena.enemyBodies : [DEFAULT_BODY_ID]
  const bodyIds = Array.from({ length: rng.int(1, 4) }, () => rng.pick(bodies))

  createSnake(world, {
    id: nextEntityId(world, 'enemy'),
    name: 'Bug',
    control: 'enemy',
    slot: -1,
    headId: rng.pick(heads),
    bodyIds,
    x: point.x,
    z: point.z,
    angle: rng.range(-Math.PI, Math.PI),
    speed: BALANCE.enemySpeed,
  })
}

export function createPickup(
  world: World,
  kind: PickupKind,
  x: number,
  z: number,
  partId?: string,
): Pickup {
  const limitX = world.arena.width / 2 - 1
  const limitZ = world.arena.depth / 2 - 1
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
  const point = randomPointInArena(world.rng, world.arena, 2)
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
  const jitter = (): number => rng.range(-1.5, 1.5)

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

export function countEnemies(world: World): number {
  return world.snakes.filter((snake) => snake.control === 'enemy' && snake.alive).length
}

export function countApples(world: World): number {
  return world.pickups.filter((pickup) => pickup.kind === 'apple').length
}
