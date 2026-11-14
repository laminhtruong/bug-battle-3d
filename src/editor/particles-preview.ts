import type { BatchedRenderer, ParticleSystem } from 'three.quarks'

export function updateParticlePreview(
  batch: BatchedRenderer,
  systems: readonly ParticleSystem[],
  delta: number,
): void {
  // Restart/export serializes this group, so preview must not delete authored emitters.
  const disposable = systems.filter((system) => system.autoDestroy)
  for (const system of disposable) system.autoDestroy = false
  try {
    batch.update(delta)
  } finally {
    for (const system of disposable) system.autoDestroy = true
  }
}
