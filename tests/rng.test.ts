import { describe, expect, it } from 'vitest'
import { createRng, fnv1a } from '@/core/rng'

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const first = createRng(1234)
    const second = createRng(1234)
    const values = Array.from({ length: 20 }, () => first.next())
    const repeated = Array.from({ length: 20 }, () => second.next())
    expect(values).toEqual(repeated)
  })

  it('keeps int inside the requested range', () => {
    const rng = createRng(7)
    for (let index = 0; index < 500; index += 1) {
      const value = rng.int(2, 5)
      expect(value).toBeGreaterThanOrEqual(2)
      expect(value).toBeLessThan(5)
    }
  })

  it('hashes strings stably', () => {
    expect(fnv1a('claw01')).toBe(fnv1a('claw01'))
    expect(fnv1a('claw01')).not.toBe(fnv1a('claw02'))
    expect(fnv1a('')).toHaveLength(8)
  })
})
