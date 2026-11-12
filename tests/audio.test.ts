import { describe, expect, it } from 'vitest'
import { soundForEvent } from '@/audio/sfx'
import { SOUND_NAMES } from '@/data/sounds'
import type { WorldEvent } from '@/sim/types'

describe('sound effects', () => {
  it('maps gameplay events to effects', () => {
    const apple: WorldEvent = {
      type: 'pickup',
      snakeId: 'you',
      pickupId: 'p1',
      kind: 'apple',
      x: 0,
      z: 0,
    }
    expect(soundForEvent(apple)).toBe('eat-apple')
    expect(soundForEvent({ ...apple, kind: 'head' })).toBe('power-up')
    expect(soundForEvent({ type: 'destroyed', x: 0, z: 0, partId: 'claw01', slot: 'head' })).toBe(
      'pop',
    )
    expect(soundForEvent({ type: 'hit', x: 0, z: 0, damage: 1 })).toBe('bite')
    expect(soundForEvent({ type: 'round-end' })).toBeUndefined()
  })

  it('keeps the wire names in sync with the shipped files', () => {
    expect(SOUND_NAMES).toContain('eat-apple')
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length)
  })
})
