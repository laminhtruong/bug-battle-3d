import { describe, expect, it } from 'vitest'
import { CONTENT_HASH } from '@/content'
import { classicArena } from '@/content/arenas/classic'
import { createWorld } from '@/sim/world'
import {
  PROTOCOL_VERSION,
  encodeMessage,
  parseClientMessage,
  parseHostMessage,
} from '@/net/protocol'
import { createSnapshot, toRenderState } from '@/net/snapshot'

describe('protocol', () => {
  it('accepts a well formed hello', () => {
    const message = parseClientMessage(
      encodeMessage({
        v: PROTOCOL_VERSION,
        t: 'hello',
        name: 'Player',
        contentHash: CONTENT_HASH,
      }),
    )
    expect(message?.t).toBe('hello')
  })

  it('rejects malformed, oversized and versioned messages', () => {
    expect(parseClientMessage('not json')).toBeUndefined()
    expect(
      parseClientMessage(
        JSON.stringify({ v: 99, t: 'hello', name: 'A', contentHash: CONTENT_HASH }),
      ),
    ).toBeUndefined()
    expect(
      parseClientMessage(
        encodeMessage({ v: PROTOCOL_VERSION, t: 'hello', name: '', contentHash: CONTENT_HASH }),
      ),
    ).toBeUndefined()
    expect(parseClientMessage('x'.repeat(5000))).toBeUndefined()
  })

  it('rejects out of range input', () => {
    const valid = {
      v: PROTOCOL_VERSION,
      t: 'input',
      seq: 1,
      x: 0.5,
      z: -0.5,
    }
    expect(parseClientMessage(encodeMessage(valid))?.t).toBe('input')
    expect(parseClientMessage(encodeMessage({ ...valid, x: 2 }))).toBeUndefined()
    expect(parseClientMessage(encodeMessage({ ...valid, seq: -1 }))).toBeUndefined()
  })

  it('round-trips a snapshot', () => {
    const world = createWorld({ seed: 21, arena: classicArena })
    const snapshot = createSnapshot(world)
    const decoded = parseHostMessage(encodeMessage(snapshot))
    expect(decoded?.t).toBe('snap')
    if (decoded?.t !== 'snap') {
      return
    }
    const state = toRenderState(decoded)
    expect(state.snakes.length).toBe(world.snakes.length)
    expect(state.snakes[0]?.segments.length).toBe(world.snakes[0]?.segments.length)
    expect(state.snakes[0]?.segments[0]?.hurtUntil).toBe(world.snakes[0]?.segments[0]?.hurtUntil)
    expect(state.pickups.length).toBe(world.pickups.length)
    expect(state.time).toBe(world.time)
  })

  it('carries sound effects and drops unknown names', () => {
    const world = createWorld({ seed: 21, arena: classicArena })
    const snapshot = createSnapshot(world, [
      { by: 'you', name: 'eat-apple' },
      { by: 'bot-1', name: 'pop' },
    ])
    const decoded = parseHostMessage(encodeMessage(snapshot))
    expect(decoded?.t === 'snap' && decoded.sfx).toEqual([
      { by: 'you', name: 'eat-apple' },
      { by: 'bot-1', name: 'pop' },
    ])

    const broken = { ...snapshot, sfx: [{ by: 'you', name: 'not-a-sound' }] }
    expect(parseHostMessage(encodeMessage(broken))).toBeUndefined()
  })
})
