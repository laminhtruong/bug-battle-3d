import { describe, expect, it } from 'vitest'
import { soundsForEvent } from '@/audio/sfx'
import { SOUND_NAMES } from '@/data/sounds'
import type { WorldEvent } from '@/sim/types'

describe('sound effects', () => {
  it('tags every effect with the snake it belongs to', () => {
    const apple: WorldEvent = {
      type: 'pickup',
      snakeId: 'you',
      pickupId: 'p1',
      kind: 'apple',
      x: 0,
      z: 0,
    }
    expect(soundsForEvent(apple)).toEqual([{ by: 'you', name: 'eat-apple' }])
    expect(soundsForEvent({ ...apple, kind: 'head' })).toEqual([{ by: 'you', name: 'power-up' }])
    expect(
      soundsForEvent({
        type: 'destroyed',
        targetId: 'you',
        attackerId: 'bot-1',
        x: 0,
        z: 0,
        partId: 'claw01',
        slot: 'head',
      }),
    ).toEqual([
      { by: 'you', name: 'pop' },
      { by: 'bot-1', name: 'pop' },
    ])
    expect(soundsForEvent({ type: 'hit', targetId: 'you', x: 0, z: 0, damage: 1 })).toEqual([
      { by: 'you', name: 'bite' },
    ])
    expect(soundsForEvent({ type: 'round-end' })).toEqual([])
  })

  it('keeps the wire names in sync with the shipped files', () => {
    expect(SOUND_NAMES).toContain('eat-apple')
    expect(new Set(SOUND_NAMES).size).toBe(SOUND_NAMES.length)
  })
})
