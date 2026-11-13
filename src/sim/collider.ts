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

  for (const box of part.collider.boxes) {
    const boxCos = Math.cos(box.angle)
    const boxSin = Math.sin(box.angle)
    // Both the segment and the box turn, so their angles add on the plane.
    const cosA = cos * boxCos - sin * boxSin
    const sinA = sin * boxCos + cos * boxSin
    const centerX = localToWorldX(box.x, box.z, segment, cos, sin)
    const centerZ = localToWorldZ(box.x, box.z, segment, cos, sin)
    const dx = x - centerX
    const dz = z - centerZ
    const localX = dx * cosA - dz * sinA
    const localZ = dx * sinA + dz * cosA
    const nearestX = Math.min(box.halfWidth, Math.max(-box.halfWidth, localX))
    const nearestZ = Math.min(box.halfDepth, Math.max(-box.halfDepth, localZ))
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
    const boxCos = Math.cos(box.angle)
    const boxSin = Math.sin(box.angle)
    const cosA = cos * boxCos - sin * boxSin
    const sinA = sin * boxCos + cos * boxSin
    const centerX = localToWorldX(box.x, box.z, segment, cos, sin)
    const centerZ = localToWorldZ(box.x, box.z, segment, cos, sin)

    // The cone can start inside the part it is touching.
    const dx = originX - centerX
    const dz = originZ - centerZ
    const localX = dx * cosA - dz * sinA
    const localZ = dx * sinA + dz * cosA
    if (Math.abs(localX) <= box.halfWidth && Math.abs(localZ) <= box.halfDepth) {
      return true
    }

    // Four corners, four edge midpoints and the centre cover the box well
    // enough for a 25 degree cone without a full polygon clip.
    for (const sampleX of [-box.halfWidth, 0, box.halfWidth]) {
      for (const sampleZ of [-box.halfDepth, 0, box.halfDepth]) {
        if (
          insideCone(
            centerX + sampleX * cosA + sampleZ * sinA,
            centerZ - sampleX * sinA + sampleZ * cosA,
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

  // Add each box's own yaw to its segment angle before testing the axes.
  const firstBoxCos = firstCos * Math.cos(first.angle) - firstSin * Math.sin(first.angle)
  const firstBoxSin = firstSin * Math.cos(first.angle) + firstCos * Math.sin(first.angle)
  const secondBoxCos = secondCos * Math.cos(second.angle) - secondSin * Math.sin(second.angle)
  const secondBoxSin = secondSin * Math.cos(second.angle) + secondCos * Math.sin(second.angle)

  const axes = [
    [firstBoxCos, -firstBoxSin],
    [firstBoxSin, firstBoxCos],
    [secondBoxCos, -secondBoxSin],
    [secondBoxSin, secondBoxCos],
  ] as const

  for (const [axisX, axisZ] of axes) {
    const distance = Math.abs(dx * axisX + dz * axisZ)
    const firstRadius =
      first.halfWidth * Math.abs(axisX * firstBoxCos - axisZ * firstBoxSin) +
      first.halfDepth * Math.abs(axisX * firstBoxSin + axisZ * firstBoxCos)
    const secondRadius =
      second.halfWidth * Math.abs(axisX * secondBoxCos - axisZ * secondBoxSin) +
      second.halfDepth * Math.abs(axisX * secondBoxSin + axisZ * secondBoxCos)
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

/** Farthest head-to-target distance at which the attacker's hitbox can touch. */
export function contactReach(
  attacker: { part: PartDef; segment: Segment },
  attackerAnchor: { x: number; z: number },
  targets: readonly { part: PartDef; segment: Segment }[],
  targetAnchor: { x: number; z: number },
  direction: { x: number; z: number },
): number {
  let reach = 0
  for (const attackBox of attacker.part.collider.boxes) {
    if (!attackBox.hitbox) {
      continue
    }
    const attackCos = Math.cos(attacker.segment.angle)
    const attackSin = Math.sin(attacker.segment.angle)
    const attackX =
      localToWorldX(attackBox.x, attackBox.z, attacker.segment, attackCos, attackSin) -
      attackerAnchor.x
    const attackZ =
      localToWorldZ(attackBox.x, attackBox.z, attacker.segment, attackCos, attackSin) -
      attackerAnchor.z
    const attackBoxCos =
      attackCos * Math.cos(attackBox.angle) - attackSin * Math.sin(attackBox.angle)
    const attackBoxSin =
      attackSin * Math.cos(attackBox.angle) + attackCos * Math.sin(attackBox.angle)

    for (const target of targets) {
      for (const targetBox of target.part.collider.boxes) {
        const targetCos = Math.cos(target.segment.angle)
        const targetSin = Math.sin(target.segment.angle)
        const targetX =
          localToWorldX(targetBox.x, targetBox.z, target.segment, targetCos, targetSin) -
          targetAnchor.x
        const targetZ =
          localToWorldZ(targetBox.x, targetBox.z, target.segment, targetCos, targetSin) -
          targetAnchor.z
        const targetBoxCos =
          targetCos * Math.cos(targetBox.angle) - targetSin * Math.sin(targetBox.angle)
        const targetBoxSin =
          targetSin * Math.cos(targetBox.angle) + targetCos * Math.sin(targetBox.angle)
        const axes = [
          [attackBoxCos, -attackBoxSin],
          [attackBoxSin, attackBoxCos],
          [targetBoxCos, -targetBoxSin],
          [targetBoxSin, targetBoxCos],
        ] as const
        let minDistance = -Infinity
        let maxDistance = Infinity
        let possible = true

        for (const [axisX, axisZ] of axes) {
          const attackRadius =
            attackBox.halfWidth * Math.abs(axisX * attackBoxCos - axisZ * attackBoxSin) +
            attackBox.halfDepth * Math.abs(axisX * attackBoxSin + axisZ * attackBoxCos)
          const targetRadius =
            targetBox.halfWidth * Math.abs(axisX * targetBoxCos - axisZ * targetBoxSin) +
            targetBox.halfDepth * Math.abs(axisX * targetBoxSin + axisZ * targetBoxCos)
          const offset = (targetX - attackX) * axisX + (targetZ - attackZ) * axisZ
          const slope = direction.x * axisX + direction.z * axisZ
          const radius = attackRadius + targetRadius

          if (Math.abs(slope) < 1e-8) {
            if (Math.abs(offset) > radius) {
              possible = false
              break
            }
            continue
          }

          const first = (-radius - offset) / slope
          const second = (radius - offset) / slope
          minDistance = Math.max(minDistance, Math.min(first, second))
          maxDistance = Math.min(maxDistance, Math.max(first, second))
          if (minDistance > maxDistance) {
            possible = false
            break
          }
        }

        if (possible && maxDistance >= Math.max(0, minDistance)) {
          reach = Math.max(reach, maxDistance)
        }
      }
    }
  }
  return reach
}
