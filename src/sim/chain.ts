import type { Vec2 } from '@/core/math2d'

/**
 * The chain is rebuilt from the head trail instead of tracking one object per
 * body part. That keeps the simulation cheap, deterministic and easy to send
 * over the network: clients only need the sampled head path.
 *
 * The trail stores positions oldest first, so the head is the last element.
 */

/** Appends the head position and drops samples that no longer matter. */
export function appendTrail(trail: Vec2[], x: number, z: number, maxDistance: number): void {
  const head = trail[trail.length - 1]
  if (!head || Math.hypot(x - head.x, z - head.z) > 1e-3) {
    trail.push({ x, z })
  }

  let traveled = 0
  let keepFrom = trail.length - 1
  for (let i = trail.length - 1; i > 0; i -= 1) {
    const current = trail[i]
    const previous = trail[i - 1]
    if (!current || !previous) {
      break
    }
    traveled += Math.hypot(current.x - previous.x, current.z - previous.z)
    keepFrom = i - 1
    if (traveled > maxDistance) {
      break
    }
  }
  if (keepFrom > 0) {
    trail.splice(0, keepFrom)
  }
}

/** Returns the point `offset` units behind the head along the trail. */
export function sampleTrail(trail: readonly Vec2[], offset: number): Vec2 {
  const head = trail[trail.length - 1]
  if (!head) {
    return { x: 0, z: 0 }
  }
  let remaining = offset
  for (let i = trail.length - 1; i > 0; i -= 1) {
    const current = trail[i]
    const previous = trail[i - 1]
    if (!current || !previous) {
      break
    }
    const length = Math.hypot(current.x - previous.x, current.z - previous.z)
    if (remaining <= length) {
      const t = length < 1e-9 ? 0 : remaining / length
      return {
        x: current.x + (previous.x - current.x) * t,
        z: current.z + (previous.z - current.z) * t,
      }
    }
    remaining -= length
  }
  const oldest = trail[0] ?? head
  return { x: oldest.x, z: oldest.z }
}
