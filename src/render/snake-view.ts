import * as THREE from 'three'
import { fnv1a } from '@/core/rng'
import type { PartDef } from '@/content/define'
import { getPartModel, clonePartModel } from './models'
import { createShadow } from './shadow'
import type { RenderState } from './state'

const SLOT_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#b197fc']

const HEAD_GEOMETRY = new THREE.ConeGeometry(0.42, 1.05, 12)
HEAD_GEOMETRY.rotateX(Math.PI / 2)
const BODY_GEOMETRY = new THREE.IcosahedronGeometry(0.3, 0)
const RING_GEOMETRY = new THREE.RingGeometry(0.34, 0.46, 24)
RING_GEOMETRY.rotateX(-Math.PI / 2)

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
  shadow: THREE.Mesh
  height: number
  model: boolean
}

interface SnakeView {
  group: THREE.Group
  segments: SegmentView[]
  ring: THREE.Mesh
}

function createSegment(slot: PartDef['slot'], id: string): SegmentView {
  const head = slot === 'head'
  const model = clonePartModel(slot, id)
  if (model) {
    // Models are normalised so their feet sit on the group origin.
    return {
      key: `${slot}:${id}`,
      node: model,
      shadow: createShadow(head ? 1 : 0.8),
      height: 0,
      model: true,
    }
  }
  const mesh = new THREE.Mesh(head ? HEAD_GEOMETRY : BODY_GEOMETRY, getPartMaterial(slot, id))
  if (!head) {
    mesh.scale.set(1, 0.85, 1.1)
  }
  return {
    key: `${slot}:${id}`,
    node: mesh,
    shadow: createShadow(head ? 1 : 0.8),
    height: head ? 0.55 : 0.4,
    model: false,
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
    sync(world: RenderState): void {
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
          const upgraded = !entry?.model && getPartModel(segment.slot, segment.partId)
          if (entry?.key !== key || upgraded) {
            if (entry) {
              view.group.remove(entry.node)
              view.group.remove(entry.shadow)
            }
            // Models load asynchronously, so a segment can swap from primitive to model.
            entry = createSegment(segment.slot, segment.partId)
            view.segments[index] = entry
            view.group.add(entry.node)
            view.group.add(entry.shadow)
          }
          entry.node.visible = true
          entry.node.position.set(segment.x, entry.height, segment.z)
          entry.node.rotation.y = segment.angle
          entry.shadow.visible = true
          entry.shadow.position.set(segment.x, 0.02, segment.z)
        }

        for (let index = snake.segments.length; index < view.segments.length; index += 1) {
          const entry = view.segments[index]
          if (entry) {
            entry.node.visible = false
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
          scene.remove(view.group)
          views.delete(id)
        }
      }
    },
  }
}
