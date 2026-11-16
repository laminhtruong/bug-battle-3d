import { Vector3 } from 'three'
import type { Object3D, Scene } from 'three'
import { BatchedRenderer, QuarksUtil } from 'three.quarks'
import type { ParticleSystem } from 'three.quarks'
import { loadProjectEffect } from 'quarks-particle-editor/loader'
import type { Slot } from '@/content/define'

interface Instance {
  group: Object3D
  systems: ParticleSystem[]
}

const templates = new Map<string, Promise<Object3D | undefined>>()

export function createParticles(scene: Scene) {
  const batch = new BatchedRenderer()
  scene.add(batch)
  const trails = new Map<string, { position: Vector3; instance?: Instance }>()

  function loadTemplate(id: string): Promise<Object3D | undefined> {
    let template = templates.get(id)
    if (!template) {
      const base = typeof document === 'undefined' ? undefined : document.baseURI
      const baseUrl = import.meta.env?.BASE_URL || './'
      const url = new URL(`${baseUrl}particles/${id}.json`, base || 'http://localhost/').href
      template = loadProjectEffect(url).catch((error: unknown) => {
        console.error(`Could not load particle effect "${id}".`, error)
        return undefined
      })
      templates.set(id, template)
    }
    return template
  }

  function attach(template: Object3D, parent: Object3D, x: number, y: number, z: number): Instance {
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

  function spawn(
    id: string,
    parent: Object3D,
    x: number,
    y: number,
    z: number,
  ): Promise<Instance | undefined> {
    return loadTemplate(id).then((template) => {
      if (!template || (parent !== scene && !parent.parent)) return undefined
      return attach(template, parent, x, y, z)
    })
  }

  return {
    explode(x: number, z: number): void {
      void spawn('death-explosion', scene, x, 0.5, z)
    },

    flame(parent: Object3D, slot: Slot, x: number, y: number, z: number, angle: number): void {
      void spawn(slot === 'head' ? 'flame-head' : 'flame-body', parent, x, y, z).then(
        (instance) => {
          if (instance) instance.group.rotation.y += angle
        },
      )
    },

    shot(id: string, visual: string, x: number, y: number, z: number): void {
      const effectId =
        visual === 'lightning' ? 'lightning-orb' : visual === 'poison' ? 'poison-orb' : visual
      let trail = trails.get(id)
      if (!trail) {
        trail = { position: new Vector3(x, y, z) }
        trails.set(id, trail)
        const pending = trail
        void loadTemplate(effectId).then((template) => {
          if (!template || trails.get(id) !== pending) return
          pending.instance = attach(
            template,
            scene,
            pending.position.x,
            pending.position.y,
            pending.position.z,
          )
        })
      } else {
        trail.position.set(x, y, z)
        trail.instance?.group.position.copy(trail.position)
      }
    },

    impact(kind: string, x: number, y: number, z: number): void {
      void spawn(
        kind === 'lightning' || kind === 'poison' ? `${kind}-impact` : kind,
        scene,
        x,
        y,
        z,
      )
    },

    dropShot(id: string): void {
      const trail = trails.get(id)
      if (!trail) return
      for (const system of trail.instance?.systems ?? []) system.dispose()
      trail.instance?.group.parent?.remove(trail.instance.group)
      trails.delete(id)
    },

    update(dt: number): void {
      batch.update(dt)
    },
  }
}
