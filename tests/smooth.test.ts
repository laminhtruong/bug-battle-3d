import { describe, expect, it } from 'vitest'
import { createSmoother } from '@/render/smooth'
import type { RenderState } from '@/render/state'

function makeState(): RenderState {
  return {
    time: 0,
    duration: 90,
    ended: false,
    snakes: [
      {
        id: 'you',
        name: 'You',
        control: 'human',
        slot: 0,
        alive: true,
        score: 0,
        segments: [
          { partId: 'claw01', slot: 'head', dead: false, x: 0, z: 0, angle: 0 },
          { partId: 'normal', slot: 'body', dead: false, x: 0, z: -0.3, angle: 0 },
        ],
      },
    ],
    projectiles: [{ id: 'p-1', visual: 'bullet', x: 0, z: 0 }],
    areas: [],
    pickups: [],
  }
}

describe('render smoothing', () => {
  it('draws between the captured pose and the newest one', () => {
    const state = makeState()
    const smoother = createSmoother()
    smoother.capture(state)

    const head = state.snakes[0]!.segments[0]!
    head.x = 1
    head.z = 0.4
    head.angle = 0.5

    const shown = smoother.sample(state, 0.5)
    expect(shown.snakes[0]?.segments[0]).toMatchObject({ x: 0.5, z: 0.2, angle: 0.25 })
    // The body has not moved, so it stays put.
    expect(shown.snakes[0]?.segments[1]).toMatchObject({ x: 0, z: -0.3 })
  })

  it('takes the short way around when turning past PI', () => {
    const state = makeState()
    const smoother = createSmoother()
    const head = state.snakes[0]!.segments[0]!
    head.angle = 3.1
    smoother.capture(state)

    head.angle = -3.1

    const shown = smoother.sample(state, 0.5)
    expect(shown.snakes[0]?.segments[0]?.angle).toBeCloseTo(Math.PI, 3)
  })

  it('snaps instead of sliding when a snake respawns across the arena', () => {
    const state = makeState()
    const smoother = createSmoother()
    smoother.capture(state)

    const head = state.snakes[0]!.segments[0]!
    head.x = 20

    expect(smoother.sample(state, 0.1).snakes[0]?.segments[0]?.x).toBe(20)
  })

  it('blends projectiles and shows the newest pose at the end of a step', () => {
    const state = makeState()
    const smoother = createSmoother()
    smoother.capture(state)

    const shot = state.projectiles[0]!
    shot.z = 0.5

    expect(smoother.sample(state, 0.5).projectiles[0]?.z).toBe(0.25)
    expect(smoother.sample(state, 1).projectiles[0]?.z).toBe(0.5)
  })

  it('does not blend across matches', () => {
    const state = makeState()
    const smoother = createSmoother()
    smoother.capture(state)
    smoother.reset()

    state.snakes[0]!.segments[0]!.x = 1

    expect(smoother.sample(state, 0.5).snakes[0]?.segments[0]?.x).toBe(1)
  })
})
