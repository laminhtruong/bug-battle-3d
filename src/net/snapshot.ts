import { PROTOCOL_VERSION, type Snapshot } from './protocol'
import type { RenderState } from '@/render/state'
import type { World } from '@/sim/types'
import type { SoundEvent } from '@/data/sounds'

export function createSnapshot(world: World, sfx: SoundEvent[] = []): Snapshot {
  return {
    v: PROTOCOL_VERSION,
    t: 'snap',
    time: world.time,
    duration: world.duration,
    ended: world.ended,
    snakes: world.snakes.map((snake) => ({
      id: snake.id,
      name: snake.name,
      control: snake.control,
      slot: snake.slot,
      alive: snake.alive,
      score: snake.score,
      segments: snake.segments.map((segment) => ({
        partId: segment.partId,
        slot: segment.slot,
        x: segment.x,
        z: segment.z,
        angle: segment.angle,
      })),
    })),
    projectiles: world.projectiles.map((projectile) => ({
      id: projectile.id,
      visual: projectile.visual,
      x: projectile.x,
      z: projectile.z,
    })),
    areas: world.areas.map((area) => ({
      id: area.id,
      partId: area.partId,
      x: area.x,
      z: area.z,
      radius: area.radius,
    })),
    pickups: world.pickups.map((pickup) => {
      const entry: Snapshot['pickups'][number] = {
        id: pickup.id,
        kind: pickup.kind,
        x: pickup.x,
        z: pickup.z,
      }
      if (pickup.partId) {
        entry.partId = pickup.partId
      }
      return entry
    }),
    sfx,
  }
}

export function toRenderState(snapshot: Snapshot): RenderState {
  return {
    time: snapshot.time,
    duration: snapshot.duration,
    ended: snapshot.ended,
    snakes: snapshot.snakes,
    projectiles: snapshot.projectiles,
    areas: snapshot.areas,
    pickups: snapshot.pickups,
  }
}
