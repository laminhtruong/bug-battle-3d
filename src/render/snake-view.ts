import * as THREE from 'three'
import { fnv1a } from '@/core/rng'
import { BALANCE } from '@/data/balance'
import type { PartDef } from '@/content/define'
import { createEffects, createGlow } from './effects'
import { getPartModel, clonePartModel, getBonesModel, cloneBonesModel, getPartClip } from './models'
import { createShadow } from './shadow'
import type { RenderState } from './state'

const HEAD_GEOMETRY = new THREE.ConeGeometry(0.42, 1.05, 12)
HEAD_GEOMETRY.rotateX(Math.PI / 2)
const BODY_GEOMETRY = new THREE.IcosahedronGeometry(0.3, 0)

/** Stands in for the bones until the real bone model has loaded. */
const BONES_GEOMETRY = new THREE.SphereGeometry(0.2, 10, 6)
const BONES_MATERIAL = new THREE.MeshBasicMaterial({ color: '#e8e0cc' })

const materialCache = new Map<string, THREE.MeshToonMaterial>()

/** Placeholder colour, used until the real model for a part has loaded. */
export function getPartMaterial(slot: PartDef['slot'], id: string): THREE.MeshToonMaterial {
  const key = `${slot}:${id}`
  const cached = materialCache.get(key)
  if (cached) {
    return cached
  }
  const hue = Number.parseInt(fnv1a(key).slice(0, 4), 16) / 65_536
  const color = new THREE.Color().setHSL(hue, 0.62, slot === 'head' ? 0.58 : 0.48)
  const material = new THREE.MeshToonMaterial({ color })
  materialCache.set(key, material)
  return material
}

interface SegmentView {
  key: string
  node: THREE.Object3D
  /** Remains of a lost part, shown in place of the model. */
  bones: THREE.Object3D
  shadow: THREE.Mesh
  /** Soft player-only pool on the floor, in place of the old team ring. */
  glow: THREE.Mesh
  /** Per-segment material copies, so a hit only flashes the part that was hit. */
  materials: THREE.MeshToonMaterial[]
  flash: number
  dead: boolean
  height: number
  model: boolean
  boneModel: boolean
  /** Plays the leg walk cycle of a body while the snake moves. */
  mixer?: THREE.AnimationMixer
  lastX: number
  lastZ: number
}

interface SnakeView {
  group: THREE.Group
  segments: SegmentView[]
}

/** Copies a segment's material, so the hurt flash cannot light up the whole snake. */
function ownMaterials(node: THREE.Object3D): THREE.MeshToonMaterial[] {
  const copies = new Map<THREE.MeshToonMaterial, THREE.MeshToonMaterial>()
  const materials: THREE.MeshToonMaterial[] = []
  node.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return
    }
    const source = child.material
    if (!(source instanceof THREE.MeshToonMaterial)) {
      return
    }
    let material = copies.get(source)
    if (!material) {
      material = source.clone()
      copies.set(source, material)
      materials.push(material)
    }
    child.material = material
  })
  return materials
}

function createSegment(slot: PartDef['slot'], id: string): SegmentView {
  const head = slot === 'head'
  const bones = cloneBonesModel(slot)
  const boneModel = bones !== undefined
  const bonesNode = bones ?? new THREE.Mesh(BONES_GEOMETRY, BONES_MATERIAL)
  bonesNode.visible = false
  const model = clonePartModel(slot, id)
  const glow = createGlow(head)
  glow.visible = false
  if (model) {
    const clip = getPartClip(slot, id)
    const mixer = clip ? new THREE.AnimationMixer(model) : undefined
    if (clip && mixer) {
      mixer.clipAction(clip).play()
    }
    return {
      key: `${slot}:${id}`,
      node: model,
      bones: bonesNode,
      shadow: createShadow(head ? 1 : 0.8),
      glow,
      materials: ownMaterials(model),
      flash: 0,
      dead: false,
      height: 0,
      model: true,
      boneModel,
      ...(mixer ? { mixer } : {}),
      lastX: Number.NaN,
      lastZ: Number.NaN,
    }
  }
  const mesh = new THREE.Mesh(head ? HEAD_GEOMETRY : BODY_GEOMETRY, getPartMaterial(slot, id))
  if (!head) {
    mesh.scale.set(1, 0.85, 1.1)
  }
  return {
    key: `${slot}:${id}`,
    node: mesh,
    bones: bonesNode,
    shadow: createShadow(head ? 1 : 0.8),
    glow,
    materials: ownMaterials(mesh),
    flash: 0,
    dead: false,
    height: head ? 0.55 : 0.4,
    model: false,
    boneModel,
    lastX: Number.NaN,
    lastZ: Number.NaN,
  }
}

function createSnakeView(): SnakeView {
  return { group: new THREE.Group(), segments: [] }
}

/** Keeps one object per visible segment, reusing them between ticks. */
export function createSnakeViewer(scene: THREE.Scene) {
  const views = new Map<string, SnakeView>()
  const effects = createEffects(scene)

  return {
    sync(world: RenderState, dt = 0, playerId?: string): void {
      const alive = new Set<string>()
      for (const snake of world.snakes) {
        alive.add(snake.id)
        let view = views.get(snake.id)
        if (!view) {
          view = createSnakeView()
          views.set(snake.id, view)
          scene.add(view.group)
        }

        view.group.visible = snake.alive
        if (!snake.alive) {
          continue
        }
        const own = snake.id === playerId

        for (let index = 0; index < snake.segments.length; index += 1) {
          const segment = snake.segments[index]
          if (!segment) {
            continue
          }
          const key = `${segment.slot}:${segment.partId}`
          let entry = view.segments[index]
          // Models load asynchronously, so a segment can swap from primitive to model.
          const upgraded =
            (!entry?.model && getPartModel(segment.slot, segment.partId)) ||
            (!entry?.boneModel && getBonesModel(segment.slot))
          let created = false
          if (entry?.key !== key || upgraded) {
            if (entry) {
              entry.mixer?.stopAllAction()
              view.group.remove(entry.node)
              view.group.remove(entry.bones)
              view.group.remove(entry.shadow)
              view.group.remove(entry.glow)
              for (const material of entry.materials) {
                material.dispose()
              }
              ;(entry.glow.material as THREE.Material).dispose()
            }
            // Models load asynchronously, so a segment can swap from primitive to model.
            entry = createSegment(segment.slot, segment.partId)
            view.segments[index] = entry
            view.group.add(entry.node)
            view.group.add(entry.bones)
            view.group.add(entry.shadow)
            view.group.add(entry.glow)
            created = true
          }
          // A part that arrives already broken should not pop again.
          if (!created && segment.dead && !entry.dead) {
            effects.explode(segment.x, segment.z)
          }
          entry.dead = segment.dead

          entry.node.visible = !segment.dead
          entry.node.position.set(segment.x, entry.height, segment.z)
          entry.node.rotation.y = segment.angle
          // Legs only walk while the segment is moving, like Idle/Move in the original.
          if (entry.mixer && !segment.dead) {
            const moved =
              Number.isNaN(entry.lastX) ||
              Math.hypot(segment.x - entry.lastX, segment.z - entry.lastZ) > 1e-3
            if (moved) {
              entry.mixer.update(dt)
            }
            entry.lastX = segment.x
            entry.lastZ = segment.z
          }
          entry.bones.visible = segment.dead
          entry.bones.position.set(segment.x, entry.model ? 0 : 0.2, segment.z)
          entry.bones.rotation.y = segment.angle
          entry.shadow.visible = true
          entry.shadow.position.set(segment.x, 0.02, segment.z)
          entry.glow.visible = own && !segment.dead
          entry.glow.position.set(segment.x, 0.02, segment.z)

          // The original flashes the part's emission white twice when it is hurt.
          const remaining = segment.hurtUntil - world.time
          const flash =
            !segment.dead && remaining > 0
              ? Math.sin((1 - remaining / BALANCE.hurtCooldownSec) * Math.PI * 2) ** 2
              : 0
          if (entry.flash !== flash) {
            entry.flash = flash
            for (const material of entry.materials) {
              material.emissive.setRGB(flash, flash, flash)
            }
          }
        }

        for (let index = snake.segments.length; index < view.segments.length; index += 1) {
          const entry = view.segments[index]
          if (entry) {
            entry.node.visible = false
            entry.bones.visible = false
            entry.shadow.visible = false
            entry.glow.visible = false
          }
        }
      }

      for (const [id, view] of views) {
        if (!alive.has(id)) {
          for (const entry of view.segments) {
            entry.mixer?.stopAllAction()
            for (const material of entry.materials) {
              material.dispose()
            }
            ;(entry.glow.material as THREE.Material).dispose()
          }
          scene.remove(view.group)
          views.delete(id)
        }
      }

      effects.update(dt)
    },
  }
}
