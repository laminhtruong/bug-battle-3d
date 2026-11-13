import * as THREE from 'three'
import { fnv1a } from '@/core/rng'
import type { PartDef } from '@/content/define'
import { getPartModel, clonePartModel, getBonesModel, cloneBonesModel, getPartClip } from './models'
import { createShadow } from './shadow'
import type { RenderState } from './state'

const SLOT_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#b197fc']

const HEAD_GEOMETRY = new THREE.ConeGeometry(0.42, 1.05, 12)
HEAD_GEOMETRY.rotateX(Math.PI / 2)
const BODY_GEOMETRY = new THREE.IcosahedronGeometry(0.3, 0)
const RING_GEOMETRY = new THREE.RingGeometry(0.34, 0.46, 24)
RING_GEOMETRY.rotateX(-Math.PI / 2)

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
  ring: THREE.Mesh
}

function createSegment(slot: PartDef['slot'], id: string): SegmentView {
  const head = slot === 'head'
  const bones = cloneBonesModel(slot)
  const boneModel = bones !== undefined
  const bonesNode = bones ?? new THREE.Mesh(BONES_GEOMETRY, BONES_MATERIAL)
  bonesNode.visible = false
  const model = clonePartModel(slot, id)
  if (model) {
    // Models are normalised so their feet sit on the group origin.
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
    height: head ? 0.55 : 0.4,
    model: false,
    boneModel,
    lastX: Number.NaN,
    lastZ: Number.NaN,
  }
}

function createSnakeView(slot: number): SnakeView {
  const group = new THREE.Group()
  const ring = new THREE.Mesh(
    RING_GEOMETRY,
    new THREE.MeshBasicMaterial({
      color: SLOT_COLORS[slot % SLOT_COLORS.length] ?? '#ffffff',
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  )
  ring.position.y = 0.06
  group.add(ring)
  return { group, segments: [], ring }
}

/** Keeps one object per visible segment, reusing them between ticks. */
export function createSnakeViewer(scene: THREE.Scene) {
  const views = new Map<string, SnakeView>()

  return {
    sync(world: RenderState, dt = 0): void {
      const alive = new Set<string>()
      for (const snake of world.snakes) {
        alive.add(snake.id)
        let view = views.get(snake.id)
        if (!view) {
          view = createSnakeView(snake.slot)
          views.set(snake.id, view)
          scene.add(view.group)
        }

        view.group.visible = snake.alive
        if (!snake.alive) {
          continue
        }
        view.ring.visible = snake.control !== 'enemy'

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
          if (entry?.key !== key || upgraded) {
            if (entry) {
              entry.mixer?.stopAllAction()
              view.group.remove(entry.node)
              view.group.remove(entry.bones)
              view.group.remove(entry.shadow)
            }
            // Models load asynchronously, so a segment can swap from primitive to model.
            entry = createSegment(segment.slot, segment.partId)
            view.segments[index] = entry
            view.group.add(entry.node)
            view.group.add(entry.bones)
            view.group.add(entry.shadow)
          }
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
        }

        for (let index = snake.segments.length; index < view.segments.length; index += 1) {
          const entry = view.segments[index]
          if (entry) {
            entry.node.visible = false
            entry.bones.visible = false
            entry.shadow.visible = false
          }
        }

        const head = snake.segments[0]
        if (head) {
          view.ring.position.set(head.x, 0.06, head.z)
        }
      }

      for (const [id, view] of views) {
        if (!alive.has(id)) {
          for (const entry of view.segments) {
            entry.mixer?.stopAllAction()
          }
          scene.remove(view.group)
          views.delete(id)
        }
      }
    },
  }
}
