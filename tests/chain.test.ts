import { describe, expect, it } from 'vitest'
import { appendTrail, sampleTrail } from '@/sim/chain'
import type { Vec2 } from '@/core/math2d'

function straightTrail(length: number): Vec2[] {
  const trail: Vec2[] = []
  for (let z = 0; z <= length; z += 0.25) {
    trail.push({ x: 0, z })
  }
  return trail
}

describe('chain', () => {
  it('samples points behind the head', () => {
    const trail = straightTrail(4)
    expect(sampleTrail(trail, 0)).toEqual({ x: 0, z: 4 })
    expect(sampleTrail(trail, 1).z).toBeCloseTo(3, 5)
    expect(sampleTrail(trail, 2.5).z).toBeCloseTo(1.5, 5)
  })

  it('clamps to the oldest sample when the trail is too short', () => {
    const trail = straightTrail(2)
    expect(sampleTrail(trail, 10)).toEqual({ x: 0, z: 0 })
  })

  it('drops samples beyond the useful distance', () => {
    const trail = straightTrail(20)
    appendTrail(trail, 0, 21, 3)
    const oldest = trail[0]
    expect(oldest).toBeDefined()
    expect(oldest?.z).toBeGreaterThanOrEqual(17)
  })

  it('does not append duplicate samples', () => {
    const trail: Vec2[] = [{ x: 0, z: 0 }]
    appendTrail(trail, 0, 0, 3)
    expect(trail).toHaveLength(1)
  })
})
