/**
 * Deterministic 32-bit random number generator (mulberry32).
 *
 * The simulation must be reproducible from a seed: the host owns the seed and
 * clients can replay the same decisions. Never use Math.random inside src/sim.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Random element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  const range = (min: number, max: number): number => min + next() * (max - min)

  return {
    next,
    range,
    int: (min, maxExclusive) => Math.floor(range(min, maxExclusive)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)]
      if (item === undefined) {
        throw new Error('cannot pick from an empty list')
      }
      return item
    },
  }
}

/** Stable 32-bit hash, used for content and protocol versioning. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
