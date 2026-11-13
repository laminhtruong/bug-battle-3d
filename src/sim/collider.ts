import type { ColliderBox, PartDef } from '@/content/define'
import type { Segment } from './types'

/**
 * Collision helpers for the BoxColliders authored on each part.
 * Every box is a hurtbox; boxes marked as hitboxes also deal contact damage.
 * The simulation runs on the XZ plane, so the box Y fields are ignored here.
 */

function localToWorldX(
  localX: number,
  localZ: number,
  segment: Segment,
  cos: number,
  sin: number,
): number {
  return segment.x + localX * cos + localZ * sin
}

function localToWorldZ(
  localX: number,
  localZ: number,
  segment: Segment,
  cos: number,
  sin: number,
): number {
  return segment.z - localX * sin + localZ * cos
}

/** True when a circle on the XZ plane touches any box of the part. */
export function segmentHitsCircle(
  part: PartDef,
  segment: Segment,
  x: number,
  z: number,
  radius: number,
): boolean {
  const cos = Math.cos(segment.angle)
  const sin = Math.sin(segment.angle)
  const dx = x - segment.x
  const dz = z - segment.z
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos

  for (const box of part.collider.boxes) {
    const nearestX = Math.min(box.x + box.halfWidth, Math.max(box.x - box.halfWidth, localX))
    const nearestZ = Math.min(box.z + box.halfDepth, Math.max(box.z - box.halfDepth, localZ))
    if (Math.hypot(localX - nearestX, localZ - nearestZ) <= radius) {
      return true
    }
  }
  return false
}

/** True when a cone attack touches any box of the part. */
export function segmentHitsCone(
  part: PartDef,
  segment: Segment,
  originX: number,
  originZ: number,
  angle: number,
  range: number,
  halfAngle: number,
): boolean {
  const cos = Math.cos(segment.angle)
  const sin = Math.sin(segment.angle)
  const axisX = Math.sin(angle)
  const axisZ = Math.cos(angle)
  const cosHalf = Math.cos(halfAngle)
  const rangeSquared = range * range

  const insideCone = (x: number, z: number): boolean => {
    const dx = x - originX
    const dz = z - originZ
    const distanceSquared = dx * dx + dz * dz
    if (distanceSquared > rangeSquared) {
      return false
    }
    if (distanceSquared < 1e-8) {
      return true
    }
    return (dx * axisX + dz * axisZ) / Math.sqrt(distanceSquared) >= cosHalf
  }

  for (const box of part.collider.boxes) {
    // The cone can start inside the part it is touching.
    const dx = originX - segment.x
    const dz = originZ - segment.z
    const localX = dx * cos - dz * sin
    const localZ = dx * sin + dz * cos
    if (Math.abs(localX - box.x) <= box.halfWidth && Math.abs(localZ - box.z) <= box.halfDepth) {
      return true
    }

    // Four corners, four edge midpoints and the centre cover the box well
    // enough for a 25 degree cone without a full polygon clip.
    for (const sampleX of [box.x - box.halfWidth, box.x, box.x + box.halfWidth]) {
      for (const sampleZ of [box.z - box.halfDepth, box.z, box.z + box.halfDepth]) {
        if (
          insideCone(
            localToWorldX(sampleX, sampleZ, segment, cos, sin),
            localToWorldZ(sampleX, sampleZ, segment, cos, sin),
          )
        ) {
          return true
        }
      }
    }
  }
  return false
}

function boxOverlapsBox(
  first: ColliderBox,
  firstSegment: Segment,
  firstCos: number,
  firstSin: number,
  second: ColliderBox,
  secondSegment: Segment,
  secondCos: number,
  secondSin: number,
): boolean {
  const firstX = localToWorldX(first.x, first.z, firstSegment, firstCos, firstSin)
  const firstZ = localToWorldZ(first.x, first.z, firstSegment, firstCos, firstSin)
  const secondX = localToWorldX(second.x, second.z, secondSegment, secondCos, secondSin)
  const secondZ = localToWorldZ(second.x, second.z, secondSegment, secondCos, secondSin)
  const dx = secondX - firstX
  const dz = secondZ - firstZ

  const axes = [
    [firstCos, -firstSin],
    [firstSin, firstCos],
    [secondCos, -secondSin],
    [secondSin, secondCos],
  ] as const

  for (const [axisX, axisZ] of axes) {
    const distance = Math.abs(dx * axisX + dz * axisZ)
    const firstRadius =
      first.halfWidth * Math.abs(axisX * firstCos - axisZ * firstSin) +
      first.halfDepth * Math.abs(axisX * firstSin + axisZ * firstCos)
    const secondRadius =
      second.halfWidth * Math.abs(axisX * secondCos - axisZ * secondSin) +
      second.halfDepth * Math.abs(axisX * secondSin + axisZ * secondCos)
    if (distance > firstRadius + secondRadius) {
      return false
    }
  }
  return true
}

/**
 * True when the two part boxes touch. Set a flag to consider only the boxes
 * that deal contact damage, which is how the Unity "Claw" colliders behave.
 */
export function collidersOverlap(
  firstPart: PartDef,
  firstSegment: Segment,
  secondPart: PartDef,
  secondSegment: Segment,
  firstHitboxesOnly = false,
  secondHitboxesOnly = false,
): boolean {
  const firstCos = Math.cos(firstSegment.angle)
  const firstSin = Math.sin(firstSegment.angle)
  const secondCos = Math.cos(secondSegment.angle)
  const secondSin = Math.sin(secondSegment.angle)

  for (const first of firstPart.collider.boxes) {
    if (firstHitboxesOnly && !first.hitbox) {
      continue
    }
    for (const second of secondPart.collider.boxes) {
      if (secondHitboxesOnly && !second.hitbox) {
        continue
      }
      if (
        boxOverlapsBox(
          first,
          firstSegment,
          firstCos,
          firstSin,
          second,
          secondSegment,
          secondCos,
          secondSin,
        )
      ) {
        return true
      }
    }
  }
  return false
}
