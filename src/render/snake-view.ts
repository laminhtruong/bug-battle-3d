import * as THREE from 'three'
import { fnv1a } from '@/core/rng'
import type { PartDef } from '@/content/define'
import type { World } from '@/sim/types'

const SLOT_COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#b197fc']

const HEAD_GEOMETRY = new THREE.ConeGeometry(0.42, 1.05, 12)
HEAD_GEOMETRY.rotateX(Math.PI / 2)
const BODY_GEOMETRY = new THREE.IcosahedronGeometry(0.3, 0)
const RING_GEOMETRY = new THREE.RingGeometry(0.55, 0.72, 24)
RING_GEOMETRY.rotateX(-Math.PI / 2)

const materialCache = new Map<string, THREE.MeshToonMaterial>()

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

interface SnakeView {
  group: THREE.Group
  segments: THREE.Mesh[]
  ring: THREE.Mesh
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

/** Keeps one mesh per visible segment, reusing meshes between ticks. */
export function createSnakeViewer(scene: THREE.Scene) {
  const views = new Map<string, SnakeView>()

  return {
    sync(world: World): void {
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
          let mesh = view.segments[index]
          if (!mesh) {
            mesh = new THREE.Mesh(
              index === 0 ? HEAD_GEOMETRY : BODY_GEOMETRY,
              getPartMaterial(segment.slot, segment.partId),
            )
            if (index > 0) {
              mesh.scale.set(1, 0.85, 1.1)
            }
            view.segments[index] = mesh
            view.group.add(mesh)
          }
          mesh.visible = true
          mesh.material = getPartMaterial(segment.slot, segment.partId)
          mesh.position.set(segment.x, index === 0 ? 0.55 : 0.4, segment.z)
          mesh.rotation.y = segment.angle
        }

        for (let index = snake.segments.length; index < view.segments.length; index += 1) {
          const mesh = view.segments[index]
          if (mesh) {
            mesh.visible = false
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
