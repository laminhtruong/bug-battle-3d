import { PARTS, requirePart } from '@/content'
import { PART_SCALE } from '@/content/define'
import type { AttackDef, PartDef, SpawnPoint } from '@/content/define'
import { directionFromAngle } from '@/core/math2d'
import { BALANCE } from '@/data/balance'
import { collidersOverlap, segmentHitsCircle, segmentHitsCone } from './collider'
import { nextEntityId, spawnDrops } from './spawn'
import type { Projectile, Segment, Snake, World } from './types'

interface AttackContext {
  snake: Snake
  segment: Segment
  attack: AttackDef
}

/** A part can fight when it shoots, stings or claws. */
function partCanAttack(part: PartDef): boolean {
  return (
    part.attack !== undefined ||
    (part.contact.damage > 0 && part.collider.boxes.some((box) => box.hitbox))
  )
}

/**
 * A snake keeps playing as long as one of its parts can attack. Losing the
 * head is not fatal, as long as a body still fights back.
 */
export function canAttack(snake: Snake): boolean {
  return snake.segments.some((segment) => {
    if (segment.dead) {
      return false
    }
    return partCanAttack(requirePart(segment.slot, segment.partId))
  })
}

/** Applies damage to one segment. Returns true when the segment was destroyed. */
export function damageSegment(
  world: World,
  target: Snake,
  index: number,
  damage: number,
  attacker: Snake | undefined,
  now: number,
): boolean {
  if (!target.alive || damage <= 0) {
    return false
  }
  const segment = target.segments[index]
  if (!segment || segment.dead || now < segment.hurtUntil) {
    return false
  }

  const part = requirePart(segment.slot, segment.partId)
  segment.hurtUntil = now + BALANCE.hurtCooldownSec
  segment.hp -= damage
  world.events.push({
    type: 'hit',
    targetId: target.id,
    ...(attacker ? { attackerId: attacker.id } : {}),
    x: segment.x,
    z: segment.z,
    damage,
  })

  if (segment.hp > 0) {
    return false
  }

  // The destroyed part keeps its place in the chain, only its bones remain.
  segment.dead = true
  world.events.push({
    type: 'destroyed',
    targetId: target.id,
    ...(attacker ? { attackerId: attacker.id } : {}),
    x: segment.x,
    z: segment.z,
    partId: part.id,
    slot: part.slot,
  })
  if (attacker && attacker !== target) {
    attacker.score += part.score
  }

  if (!canAttack(target)) {
    killSnake(world, target)
  }
  return true
}

export function killSnake(world: World, snake: Snake): void {
  if (!snake.alive) {
    return
  }
  snake.alive = false
  snake.respawnAt = world.time + BALANCE.respawnDelaySec
  world.events.push({
    type: 'death',
    snakeId: snake.id,
    control: snake.control,
    x: snake.x,
    z: snake.z,
  })

  const remaining = snake.segments
    .filter((segment) => !segment.dead)
    .map((segment) => ({
      slot: segment.slot,
      partId: segment.partId,
    }))
  snake.segments = []
  spawnDrops(world, snake.x, snake.z, remaining)

  if (snake.control === 'enemy') {
    world.enemyRespawns.push(world.time + BALANCE.enemyRespawnSec)
  }
}

function spawnProjectile(
  world: World,
  snake: Snake,
  segment: Segment,
  spawn: SpawnPoint,
  angle: number,
  attack: Extract<AttackDef, { kind: 'projectile' }>,
): void {
  const direction = directionFromAngle(angle)
  // The muzzle is authored in prefab units, so rotate it with the segment and
  // scale it like the art and the collider boxes.
  const cos = Math.cos(segment.angle)
  const sin = Math.sin(segment.angle)
  const localX = spawn.x * PART_SCALE
  const localZ = spawn.z * PART_SCALE
  const projectile: Projectile = {
    id: nextEntityId(world, 'shot'),
    ownerId: snake.id,
    partId: segment.partId,
    visual: attack.projectile.visual,
    x: segment.x + localX * cos + localZ * sin,
    z: segment.z - localX * sin + localZ * cos,
    vx: direction.x * attack.projectile.speed,
    vz: direction.z * attack.projectile.speed,
    damage: attack.projectile.damage,
    age: 0,
    ttl: attack.projectile.ttl,
    landed: false,
    delayLeft: 0,
  }
  if (attack.projectile.onLand) {
    projectile.onLand = attack.projectile.onLand
  }
  world.projectiles.push(projectile)
  world.events.push({
    type: 'attack',
    snakeId: snake.id,
    partId: segment.partId,
    kind: 'projectile',
    x: segment.x,
    z: segment.z,
    angle,
  })
}

function fireCone(world: World, context: AttackContext): void {
  const { snake, segment, attack } = context
  if (attack.kind !== 'cone') {
    return
  }
  const halfAngle = (attack.cone.halfAngleDeg * Math.PI) / 180
  for (const target of world.snakes) {
    if (!target.alive || target.id === snake.id) {
      continue
    }
    for (let index = target.segments.length - 1; index >= 0; index -= 1) {
      const other = target.segments[index]
      if (!other || other.dead) {
        continue
      }
      const part = requirePart(other.slot, other.partId)
      if (
        !segmentHitsCone(
          part,
          other,
          segment.x,
          segment.z,
          segment.angle,
          attack.cone.range,
          halfAngle,
        )
      ) {
        continue
      }
      damageSegment(world, target, index, 1, snake, world.time)
    }
  }
  world.events.push({
    type: 'attack',
    snakeId: snake.id,
    partId: segment.partId,
    kind: 'cone',
    x: segment.x,
    z: segment.z,
    angle: segment.angle,
  })
}

function fire(world: World, context: AttackContext): void {
  const { snake, segment, attack } = context
  if (attack.kind === 'projectile') {
    for (const spawn of attack.projectile.spawnPoints) {
      const angle = segment.angle + (spawn.angle * Math.PI) / 180
      spawnProjectile(world, snake, segment, spawn, angle, attack)
    }
  } else {
    fireCone(world, context)
  }
}

export function fireAttacks(world: World, dt: number): void {
  for (const snake of world.snakes) {
    if (!snake.alive) {
      continue
    }
    const cooldownScale = snake.control === 'enemy' ? BALANCE.enemyCooldownScale : 1
    for (const segment of snake.segments) {
      if (segment.dead) {
        continue
      }
      const part = requirePart(segment.slot, segment.partId)
      if (!part.attack) {
        continue
      }
      segment.cooldown -= dt
      if (segment.cooldown > 0) {
        continue
      }
      segment.cooldown = part.attack.cooldown * cooldownScale
      fire(world, { snake, segment, attack: part.attack })
    }
  }
}

function findProjectileHit(
  world: World,
  projectile: Projectile,
): { snake: Snake; index: number } | undefined {
  for (const snake of world.snakes) {
    if (!snake.alive || snake.id === projectile.ownerId) {
      continue
    }
    for (let index = 0; index < snake.segments.length; index += 1) {
      const segment = snake.segments[index]
      if (!segment || segment.dead) {
        continue
      }
      const part = requirePart(segment.slot, segment.partId)
      if (segmentHitsCircle(part, segment, projectile.x, projectile.z, BALANCE.projectileRadius)) {
        return { snake, index }
      }
    }
  }
  return undefined
}

function landProjectile(world: World, projectile: Projectile): void {
  const onLand = projectile.onLand
  if (!onLand) {
    return
  }
  world.areas.push({
    id: nextEntityId(world, 'area'),
    ownerId: projectile.ownerId,
    partId: projectile.partId,
    x: projectile.x,
    z: projectile.z,
    radius: onLand.radius,
    damage: projectile.damage,
    duration: onLand.duration,
    age: 0,
  })
}

export function updateProjectiles(world: World, dt: number): void {
  const survivors: Projectile[] = []
  const halfWidth = world.arena.width / 2
  const halfDepth = world.arena.depth / 2

  for (const projectile of world.projectiles) {
    projectile.age += dt

    if (projectile.landed) {
      projectile.delayLeft -= dt
      if (projectile.delayLeft <= 0) {
        landProjectile(world, projectile)
        continue
      }
      survivors.push(projectile)
      continue
    }

    projectile.x += projectile.vx * dt
    projectile.z += projectile.vz * dt
    const outOfBounds = Math.abs(projectile.x) > halfWidth || Math.abs(projectile.z) > halfDepth

    if (projectile.age >= projectile.ttl || outOfBounds) {
      if (!projectile.onLand) {
        continue
      }
      projectile.landed = true
      projectile.delayLeft = projectile.onLand.delay
      if (projectile.delayLeft <= 0) {
        landProjectile(world, projectile)
        continue
      }
      survivors.push(projectile)
      continue
    }

    if (!projectile.onLand) {
      const hit = findProjectileHit(world, projectile)
      if (hit) {
        const owner = world.snakes.find((snake) => snake.id === projectile.ownerId)
        damageSegment(world, hit.snake, hit.index, projectile.damage, owner, world.time)
        continue
      }
    }

    survivors.push(projectile)
  }

  world.projectiles = survivors
}

export function updateAreas(world: World, dt: number): void {
  const survivors: typeof world.areas = []

  for (const area of world.areas) {
    area.age += dt
    const owner = world.snakes.find((snake) => snake.id === area.ownerId)
    for (const snake of world.snakes) {
      if (!snake.alive || snake.id === area.ownerId) {
        continue
      }
      for (let index = snake.segments.length - 1; index >= 0; index -= 1) {
        const segment = snake.segments[index]
        if (!segment || segment.dead) {
          continue
        }
        const part = requirePart(segment.slot, segment.partId)
        if (segmentHitsCircle(part, segment, area.x, area.z, area.radius)) {
          damageSegment(world, snake, index, area.damage, owner, world.time)
        }
      }
    }
    if (area.age < area.duration) {
      survivors.push(area)
    }
  }

  world.areas = survivors
}

interface ContactEntry {
  snake: Snake
  index: number
  segment: Segment
  part: PartDef
  reach: number
}

const MAX_REACH = Math.max(...PARTS.map((part) => part.collider.reach))
// Three by three cells must cover the two farthest boxes, so the broad phase
// keeps working when a new part adds a longer claw.
const CONTACT_CELL = Math.max(1.5, MAX_REACH * 2)

function contactKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`
}

/** Damages touching segments. Only hitbox colliders deal contact damage. */
export function updateContact(world: World): void {
  const entries: ContactEntry[] = []
  for (const snake of world.snakes) {
    if (!snake.alive) {
      continue
    }
    for (let index = 0; index < snake.segments.length; index += 1) {
      const segment = snake.segments[index]
      if (!segment || segment.dead) {
        continue
      }
      const part = requirePart(segment.slot, segment.partId)
      entries.push({ snake, index, segment, part, reach: part.collider.reach })
    }
  }

  const grid = new Map<string, ContactEntry[]>()
  for (const entry of entries) {
    const key = contactKey(
      Math.floor(entry.segment.x / CONTACT_CELL),
      Math.floor(entry.segment.z / CONTACT_CELL),
    )
    const bucket = grid.get(key)
    if (bucket) {
      bucket.push(entry)
    } else {
      grid.set(key, [entry])
    }
  }

  for (const entry of entries) {
    const cellX = Math.floor(entry.segment.x / CONTACT_CELL)
    const cellZ = Math.floor(entry.segment.z / CONTACT_CELL)
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        const bucket = grid.get(contactKey(cellX + offsetX, cellZ + offsetZ))
        if (!bucket) {
          continue
        }
        for (const other of bucket) {
          // Each pair is handled once, from the point of view of the lower id.
          if (other.snake.id >= entry.snake.id) {
            continue
          }
          if (
            Math.hypot(entry.segment.x - other.segment.x, entry.segment.z - other.segment.z) >
            entry.reach + other.reach
          ) {
            continue
          }
          const entryHits =
            entry.part.contact.damage > 0 &&
            collidersOverlap(entry.part, entry.segment, other.part, other.segment, true, false)
          const otherHits =
            other.part.contact.damage > 0 &&
            collidersOverlap(other.part, other.segment, entry.part, entry.segment, true, false)
          if (entryHits) {
            damageSegment(
              world,
              other.snake,
              other.index,
              entry.part.contact.damage,
              entry.snake,
              world.time,
            )
          }
          if (otherHits) {
            damageSegment(
              world,
              entry.snake,
              entry.index,
              other.part.contact.damage,
              other.snake,
              world.time,
            )
          }
        }
      }
    }
  }
}
