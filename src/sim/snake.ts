import { angleFromDirection, clamp, directionFromAngle, shortestAngleDelta } from '@/core/math2d'
import { requirePart } from '@/content'
import type { Slot } from '@/content/define'
import { BALANCE } from '@/data/balance'
import { appendTrail, sampleTrail } from './chain'
import type { Snake } from './types'

/** Extra trail kept so a fully grown snake can still be sampled smoothly. */
export const TRAIL_MAX_DISTANCE = BALANCE.maxSegments * BALANCE.bodySpacing + BALANCE.headSpacing + 2

export function segmentRadius(index: number): number {
  return index === 0 ? BALANCE.segmentRadius.head : BALANCE.segmentRadius.body
}

/** Distance behind the head where a segment sits. */
export function segmentDistance(index: number): number {
  if (index <= 0) {
    return 0
  }
  return BALANCE.headSpacing + (index - 1) * BALANCE.bodySpacing
}

/**
 * Moves the head, records the path and rebuilds every segment from it.
 * The snake only moves while the player pushes the stick, like the original.
 */
export function updateMovement(
  snake: Snake,
  halfWidth: number,
  halfDepth: number,
  dt: number,
): void {
  const push = Math.hypot(snake.steerX, snake.steerZ)
  if (push > 1e-4) {
    const targetAngle = angleFromDirection(snake.steerX, snake.steerZ)
    const maxTurn = BALANCE.turnRate * dt
    snake.angle += clamp(shortestAngleDelta(snake.angle, targetAngle), -maxTurn, maxTurn)
  }

  const direction = directionFromAngle(snake.angle)
  const margin = BALANCE.segmentRadius.head
  // A light push moves slower, exactly like the joystick of the original.
  const speed = snake.speed * Math.min(1, push)
  snake.x = clamp(snake.x + direction.x * speed * dt, -halfWidth + margin, halfWidth - margin)
  snake.z = clamp(snake.z + direction.z * speed * dt, -halfDepth + margin, halfDepth - margin)

  appendTrail(snake.trail, snake.x, snake.z, TRAIL_MAX_DISTANCE)
  syncSegments(snake)
}

/** Places the head and samples each body segment along the trail. */
export function syncSegments(snake: Snake): void {
  const head = snake.segments[0]
  if (!head) {
    return
  }
  head.x = snake.x
  head.z = snake.z
  head.angle = snake.angle

  let previous = head
  for (let index = 1; index < snake.segments.length; index += 1) {
    const segment = snake.segments[index]
    if (!segment) {
      break
    }
    const point = sampleTrail(snake.trail, segmentDistance(index))
    segment.x = point.x
    segment.z = point.z
    // Body parts face the head, which matches the direction of travel.
    const dx = previous.x - point.x
    const dz = previous.z - point.z
    segment.angle = Math.hypot(dx, dz) < 1e-4 ? previous.angle : angleFromDirection(dx, dz)
    previous = segment
  }
}

/** Adds one body segment. Returns false when the chain is already at its cap. */
export function growSnake(snake: Snake, partId = 'normal'): boolean {
  if (snake.segments.length >= BALANCE.maxSegments) {
    return false
  }
  const slot: Slot = 'body'
  const part = requirePart(slot, partId)
  snake.segments.push({
    partId,
    slot,
    hp: part.hp,
    maxHp: part.hp,
    dead: false,
    x: snake.x,
    z: snake.z,
    angle: snake.angle,
    cooldown: part.attack?.cooldown ?? 0,
    hurtUntil: 0,
  })
  syncSegments(snake)
  return true
}

export function healSnake(snake: Snake): void {
  for (const segment of snake.segments) {
    if (!segment.dead) {
      segment.hp = segment.maxHp
    }
  }
}
