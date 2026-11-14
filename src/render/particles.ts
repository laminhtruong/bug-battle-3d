import type { Object3D, Scene } from 'three'
import { BatchedRenderer, QuarksLoader, QuarksUtil } from 'three.quarks'
import type { ParticleSystem } from 'three.quarks'
import type { Slot } from '@/content/define'
import { parseQuarksDocument } from '@/content/particles'

interface NativeEffect {
  metadata: { type: string }
  object: { type: string }
}

const presetFiles = import.meta.glob('../content/particles/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, NativeEffect>
const overrideFiles = import.meta.glob('../content/particle-overrides/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, NativeEffect>
const effects = new Map<string, NativeEffect>()
for (const [file, effect] of Object.entries(presetFiles)) {
  effects.set(
    file
      .split('/')
      .at(-1)!
      .replace(/\.json$/, ''),
    parseQuarksDocument(effect),
  )
}
for (const [file, effect] of Object.entries(overrideFiles)) {
  effects.set(
    file
      .split('/')
      .at(-1)!
      .replace(/\.json$/, ''),
    parseQuarksDocument(effect),
  )
}
const templates = new Map<string, Object3D>()

interface Instance {
  group: Object3D
  systems: ParticleSystem[]
}

export function createParticles(scene: Scene) {
  const batch = new BatchedRenderer()
  scene.add(batch)
  const trails = new Map<string, Instance>()

  function spawn(
    id: string,
    parent: Object3D,
    x: number,
    y: number,
    z: number,
  ): Instance | undefined {
    const source = effects.get(id)
    if (!source) return undefined
    let template = templates.get(id)
    if (!template) {
      template = new QuarksLoader().parse(structuredClone(source))
      templates.set(id, template)
    }
    const group = template.clone(true)
    group.position.set(x, y, z)
    parent.add(group)
    QuarksUtil.addToBatchRenderer(group, batch)
    const systems: ParticleSystem[] = []
    group.traverse((object) => {
      if (object.type === 'ParticleEmitter' && 'system' in object) {
        systems.push((object as Object3D & { system: ParticleSystem }).system)
      }
    })
    if (systems.some((system) => system.autoDestroy)) {
      const removeWhenDone = () => {
        if (systems.every((system) => !system.emitter.parent)) group.parent?.remove(group)
      }
      for (const system of systems) system.addEventListener('destroy', removeWhenDone)
    }
    return { group, systems }
  }

  return {
    flame(parent: Object3D, slot: Slot, x: number, y: number, z: number, angle: number): void {
      const group = spawn(slot === 'head' ? 'flame-head' : 'flame-body', parent, x, y, z)?.group
      if (group) group.rotation.y = angle
    },

    shot(id: string, visual: string, x: number, y: number, z: number): void {
      const effectId =
        visual === 'lightning' ? 'lightning-orb' : visual === 'poison' ? 'poison-orb' : visual
      let trail = trails.get(id)
      if (!trail) {
        const created = spawn(effectId, scene, x, y, z)
        if (!created) return
        trail = created
        trails.set(id, trail)
      }
      trail.group.position.set(x, y, z)
    },

    impact(kind: string, x: number, y: number, z: number): void {
      spawn(kind === 'lightning' || kind === 'poison' ? `${kind}-impact` : kind, scene, x, y, z)
    },

    dropShot(id: string): void {
      const trail = trails.get(id)
      if (!trail) return
      for (const system of trail.systems) system.dispose()
      trail.group.parent?.remove(trail.group)
      trails.delete(id)
    },

    update(dt: number): void {
      batch.update(dt)
    },
  }
}
