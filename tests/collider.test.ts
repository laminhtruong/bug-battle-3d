import { describe, expect, it } from 'vitest'
import { requirePart } from '@/content'
import { collidersOverlap, segmentHitsCircle, segmentHitsCone } from '@/sim/collider'
import type { Segment } from '@/sim/types'

function makeSegment(partId: string, x: number, z: number, angle: number): Segment {
  const part = requirePart('head', partId)
  return {
    partId,
    slot: 'head',
    hp: part.hp,
    maxHp: part.hp,
    dead: false,
    x,
    z,
    angle,
    cooldown: 0,
    hurtUntil: 0,
  }
}

describe('part colliders', () => {
  it('uses the Unity BoxCollider sizes directly', () => {
    const claw = requirePart('head', 'claw01')
    expect(claw.collider.boxes[0]).toMatchObject({
      x: 0,
      z: 0.05,
      halfWidth: 1,
      halfDepth: 0.65,
      hitbox: false,
    })
    expect(claw.collider.boxes[1]).toMatchObject({
      x: 0.65,
      z: 1.3,
      halfWidth: 0.35,
      halfDepth: 0.4,
      hitbox: true,
    })
    expect(requirePart('head', 'claw04').collider.reach).toBeGreaterThan(5)
  })

  it('tests the box shape, not a circle around the pivot', () => {
    const part = requirePart('head', 'claw01')
    const segment = makeSegment('claw01', 0, 0, 0)

    expect(segmentHitsCircle(part, segment, 0, 0, 0.01)).toBe(true)
    expect(segmentHitsCircle(part, segment, 0.65, 1.3, 0.01)).toBe(true)
    // Between the two claws and beyond the head box, a circle would still hit.
    expect(segmentHitsCircle(part, segment, 0, 1.3, 0.01)).toBe(false)
  })

  it('rotates the box footprint with its transform', () => {
    const part = requirePart('head', 'claw02')
    const segment = makeSegment('claw02', 0, 0, 0)
    const box = part.collider.boxes[1]!

    expect(box.angle).toBeCloseTo((40 * Math.PI) / 180, 6)
    // 0.7 along the rotated long axis is inside; across its width is not.
    const reach = 0.7
    const along = [
      box.x + Math.sin(box.angle) * reach,
      box.z + Math.cos(box.angle) * reach,
    ] as const
    const across = [
      box.x + Math.cos(box.angle) * reach,
      box.z - Math.sin(box.angle) * reach,
    ] as const
    expect(segmentHitsCircle(part, segment, along[0], along[1], 0.01)).toBe(true)
    expect(segmentHitsCircle(part, segment, across[0], across[1], 0.01)).toBe(false)
  })

  it('keeps contact boxes directional', () => {
    const part = requirePart('head', 'claw01')
    const forward = makeSegment('claw01', 0, 0, 0)
    const backward = makeSegment('claw01', 0, 0, Math.PI)

    expect(collidersOverlap(part, forward, part, forward, true, false)).toBe(true)
    expect(collidersOverlap(part, forward, part, backward, true, false)).toBe(false)
  })

  it('uses the box extents for cone attacks', () => {
    const part = requirePart('head', 'gun')
    const segment = makeSegment('gun', 0, 0, 0)

    expect(segmentHitsCone(part, segment, 0, -1, 0, 2, 0.5)).toBe(true)
    expect(segmentHitsCone(part, segment, 2, 0, 0, 2, 0.5)).toBe(false)
  })
})
