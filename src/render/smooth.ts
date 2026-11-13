import { shortestAngleDelta } from '@/core/math2d'
import type { RenderState } from './state'

interface Pose {
  x: number
  z: number
  angle: number
}

/**
 * A jump longer than this is a respawn or a new part, not movement, so it is
 * drawn immediately instead of sliding across the arena.
 */
const MAX_BLEND_DISTANCE = 4

export interface Smoother {
  /** Drops the captured poses, so a new match does not blend from the old one. */
  reset(): void
  /** Call right before a simulation step, with the state as it is now. */
  capture(state: RenderState): void
  /** Call once per frame. alpha 0 shows the captured pose, 1 the newest state. */
  sample(state: RenderState, alpha: number): RenderState
}

/**
 * The simulation runs at a fixed 30 Hz, so drawing its raw positions makes the
 * bugs jump once per tick. Between two ticks the renderer blends the pose
 * captured before the last tick into the newest one.
 */
export function createSmoother(): Smoother {
  let snakePoses = new Map<string, Pose[]>()
  let shotPoses = new Map<string, Pose>()

  return {
    reset: () => {
      snakePoses = new Map()
      shotPoses = new Map()
    },
    capture: (state) => {
      snakePoses = new Map(
        state.snakes.map((snake) => [
          snake.id,
          snake.segments.map(({ x, z, angle }) => ({ x, z, angle })),
        ]),
      )
      shotPoses = new Map(state.projectiles.map(({ id, x, z }) => [id, { x, z, angle: 0 }]))
    },
    sample: (state, alpha) => {
      const a = Math.min(1, Math.max(0, alpha))
      return {
        time: state.time,
        duration: state.duration,
        ended: state.ended,
        snakes: state.snakes.map((snake) => {
          const from = snakePoses.get(snake.id)
          return {
            ...snake,
            segments: snake.segments.map((segment, index) => {
              const pose = from?.[index]
              if (!pose || a >= 1) {
                return segment
              }
              return {
                ...segment,
                x: blend(pose.x, segment.x, a),
                z: blend(pose.z, segment.z, a),
                angle: pose.angle + shortestAngleDelta(pose.angle, segment.angle) * a,
              }
            }),
          }
        }),
        areas: state.areas,
        pickups: state.pickups,
        projectiles: state.projectiles.map((projectile) => {
          const pose = shotPoses.get(projectile.id)
          if (!pose || a >= 1) {
            return projectile
          }
          return {
            ...projectile,
            x: blend(pose.x, projectile.x, a),
            z: blend(pose.z, projectile.z, a),
          }
        }),
      }
    },
  }
}

function blend(from: number, to: number, alpha: number): number {
  return Math.abs(to - from) > MAX_BLEND_DISTANCE ? to : from + (to - from) * alpha
}
