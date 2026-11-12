import { requirePart } from '@/content'
import type { AttackDef } from '@/content/define'
import { angleFromDirection, directionFromAngle, shortestAngleDelta } from '@/core/math2d'
import { BALANCE } from '@/data/balance'
import { segmentRadius } from './snake'
import { nextEntityId, spawnDrops } from './spawn'
import type { Projectile, Segment, Snake, World } from './types'

interface AttackContext {
  snake: Snake
  segment: Segment
  attack: AttackDef
}

/** A part can fight when it shoots, stings or claws. */
function partCanAttack(part: ReturnType<typeof requirePart>): boolean {
  return part.attack !== undefined || part.contact.damage > 0
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
  angle: number,
  attack: Extract<AttackDef, { kind: 'projectile' }>,
): void {
  const direction = directionFromAngle(angle)
  const offset = BALANCE.segmentRadius.body + 0.15
  const projectile: Projectile = {
    id: nextEntityId(world, 'shot'),
    ownerId: snake.id,
    partId: segment.partId,
    visual: attack.projectile.visual,
    x: segment.x + direction.x * offset,
    z: segment.z + direction.z * offset,
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
      const dx = other.x - segment.x
      const dz = other.z - segment.z
      if (Math.hypot(dx, dz) > attack.cone.range + segmentRadius(index)) {
        continue
      }
      const angleTo = angleFromDirection(dx, dz)
      if (Math.abs(shortestAngleDelta(segment.angle, angleTo)) > halfAngle) {
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
    const angles =
      attack.mount === 'sides'
        ? [segment.angle + Math.PI / 2, segment.angle - Math.PI / 2]
        : [segment.angle]
    for (const angle of angles) {
      spawnProjectile(world, snake, segment, angle, attack)
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
      const reach = segmentRadius(index) + BALANCE.projectileRadius
      if (Math.hypot(segment.x - projectile.x, segment.z - projectile.z) <= reach) {
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
        const reach = area.radius + segmentRadius(index)
        if (Math.hypot(segment.x - area.x, segment.z - area.z) <= reach) {
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
  x: number
  z: number
  radius: number
  damage: number
}

const CONTACT_CELL = 1.5

function contactKey(cellX: number, cellZ: number): string {
  return `${cellX}:${cellZ}`
}

/** Damages touching segments. Only parts with contact damage hurt anything. */
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
      entries.push({
        snake,
        index,
        x: segment.x,
        z: segment.z,
        radius: segmentRadius(index),
        damage: requirePart(segment.slot, segment.partId).contact.damage,
      })
    }
  }

  const grid = new Map<string, ContactEntry[]>()
  for (const entry of entries) {
    const key = contactKey(Math.floor(entry.x / CONTACT_CELL), Math.floor(entry.z / CONTACT_CELL))
    const bucket = grid.get(key)
    if (bucket) {
      bucket.push(entry)
    } else {
      grid.set(key, [entry])
    }
  }

  for (const entry of entries) {
    const cellX = Math.floor(entry.x / CONTACT_CELL)
    const cellZ = Math.floor(entry.z / CONTACT_CELL)
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
          const reach = entry.radius + other.radius
          if (Math.hypot(entry.x - other.x, entry.z - other.z) > reach) {
            continue
          }
          if (entry.damage > 0) {
            damageSegment(world, other.snake, other.index, entry.damage, entry.snake, world.time)
          }
          if (other.damage > 0) {
            damageSegment(world, entry.snake, entry.index, other.damage, other.snake, world.time)
          }
        }
      }
    }
  }
}
