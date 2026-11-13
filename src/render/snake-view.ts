import * as THREE from 'three'
import { fnv1a } from '@/core/rng'
import { BALANCE } from '@/data/balance'
import type { PartDef } from '@/content/define'
import { createEffects } from './effects'
import { getPartModel, clonePartModel, getBonesModel, cloneBonesModel, getPartClip } from './models'
import { createShadow } from './shadow'
import type { RenderState } from './state'

const HEAD_GEOMETRY = new THREE.ConeGeometry(1.68, 4.2, 12)
HEAD_GEOMETRY.rotateX(Math.PI / 2)
const BODY_GEOMETRY = new THREE.IcosahedronGeometry(1.2, 0)

/** Stands in for the bones until the real bone model has loaded. */
const BONES_GEOMETRY = new THREE.SphereGeometry(0.8, 10, 6)
const BONES_MATERIAL = new THREE.MeshBasicMaterial({ color: '#e8e0cc' })

/** How long the part shrinks after the killing hit has finished flashing. */
const DESTROY_SEC = 0.18
/** How long a new or restored part takes to pop back in. */
const SPAWN_SEC = 0.28
/** How long the bones stay behind after a snake dies, before it vanishes. */
const DEATH_SEC = 1.4

/** Overshoots a little past 1, like a bubble appearing. */
function spawnScale(age: number): number {
  const t = Math.min(1, age / SPAWN_SEC)
  const back = 1.70158
  return 1 + (back + 1) * (t - 1) ** 3 + back * (t - 1) ** 2
}

/** One white pulse: up and back to normal, so a single hit reads as a single flash. */
function hurtFlash(left: number): number {
  return left > 0 ? Math.sin((1 - left / BALANCE.hurtCooldownSec) * Math.PI) ** 2 : 0
}

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
  /** Per-segment material copies, so a hit only flashes the part that was hit. */
  materials: THREE.MeshToonMaterial[]
  flash: number
  dead: boolean
  /** Scale the art was authored with, before the pop animations multiply it. */
  baseScale: THREE.Vector3
  /** Countdown through the final flash and the shrink; 0 means settled. */
  dying: number
  exploded: boolean
  /** Seconds into the pop-in; -1 while the segment is settled. */
  spawnAge: number
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
  alive: boolean
  /** Seconds since the snake died; only meaningful while it is dead. */
  deathAge: number
  /** The killing hit flashes the remains before they go down. */
  flashLeft: number
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
  if (model) {
    const clip = getPartClip(slot, id)
    const mixer = clip ? new THREE.AnimationMixer(model) : undefined
    if (clip && mixer) {
      // The source walk cycle reads too slow at 1x.
      mixer.timeScale = 2
      mixer.clipAction(clip).play()
    }
    return {
      key: `${slot}:${id}`,
      node: model,
      bones: bonesNode,
      shadow: createShadow(head ? 4 : 3.2),
      materials: ownMaterials(model),
      flash: 0,
      dead: false,
      // The art renders at its authored size; the pop animations multiply it.
      baseScale: model.scale.clone(),
      dying: 0,
      exploded: true,
      spawnAge: -1,
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
    shadow: createShadow(head ? 4 : 3.2),
    materials: ownMaterials(mesh),
    flash: 0,
    dead: false,
    baseScale: mesh.scale.clone(),
    dying: 0,
    exploded: true,
    spawnAge: -1,
    height: head ? 2.2 : 1.6,
    model: false,
    boneModel,
    lastX: Number.NaN,
    lastZ: Number.NaN,
  }
}

function createSnakeView(): SnakeView {
  return { group: new THREE.Group(), segments: [], alive: true, deathAge: 0, flashLeft: 0 }
}

/** The killing hit flashes the whole snake, then every living part goes down. */
function startDeath(view: SnakeView): void {
  view.deathAge = 0
  view.flashLeft = BALANCE.hurtCooldownSec
  for (const entry of view.segments) {
    if (!entry.dead) {
      entry.dead = true
      entry.dying = BALANCE.hurtCooldownSec + DESTROY_SEC
      entry.exploded = false
    }
    entry.spawnAge = -1
  }
}

type Effects = ReturnType<typeof createEffects>

/** Advances the remains. Returns true once they have vanished. */
function updateRemains(view: SnakeView, dt: number, effects: Effects): boolean {
  view.deathAge += dt
  const gone = view.deathAge >= DEATH_SEC
  view.group.visible = !gone
  view.flashLeft = Math.max(0, view.flashLeft - dt)
  // Same single white pulse as a hurt part, so the killing hit is visible.
  const flash = hurtFlash(view.flashLeft)
  for (const entry of view.segments) {
    entry.dying = Math.max(0, entry.dying - dt)
    const visible = !gone && entry.dying > 0
    const shrinking = visible && entry.dying <= DESTROY_SEC
    entry.node.visible = visible
    if (visible && !shrinking) {
      for (const material of entry.materials) {
        material.emissive.setRGB(flash, flash, flash)
      }
    }
    if (shrinking) {
      if (!entry.exploded) {
        effects.explode(entry.node.position.x, entry.node.position.z)
        entry.exploded = true
        for (const material of entry.materials) {
          material.emissive.setRGB(0, 0, 0)
        }
      }
      const shrink = 1 - entry.dying / DESTROY_SEC
      entry.node.scale.copy(entry.baseScale).multiplyScalar(Math.max(0.001, 1 - shrink * shrink))
    }
    entry.bones.visible = !gone && entry.dying <= 0
    entry.shadow.visible = !gone
  }
  return gone
}

/** Keeps one object per visible segment, reusing them between ticks. */
export function createSnakeViewer(scene: THREE.Scene) {
  const views = new Map<string, SnakeView>()
  const effects = createEffects(scene)

  return {
    sync(world: RenderState, dt = 0): void {
      const alive = new Set<string>()
      for (const snake of world.snakes) {
        alive.add(snake.id)
        let view = views.get(snake.id)
        if (!view) {
          view = createSnakeView()
          views.set(snake.id, view)
          scene.add(view.group)
        }

        if (view.alive && !snake.alive) {
          startDeath(view)
        }
        view.alive = snake.alive
        if (!snake.alive) {
          updateRemains(view, dt, effects)
          continue
        }
        view.group.visible = true
        for (let index = 0; index < snake.segments.length; index += 1) {
          const segment = snake.segments[index]
          if (!segment) {
            continue
          }
          const key = `${segment.slot}:${segment.partId}`
          let entry = view.segments[index]
          const keyChanged = entry?.key !== key
          // Models load asynchronously, so a segment can swap from primitive to model.
          const upgraded =
            !keyChanged &&
            ((!entry?.model && getPartModel(segment.slot, segment.partId)) ||
              (!entry?.boneModel && getBonesModel(segment.slot)))
          let created = false
          let pop = false
          if (keyChanged || upgraded) {
            if (entry) {
              entry.mixer?.stopAllAction()
              view.group.remove(entry.node)
              view.group.remove(entry.bones)
              view.group.remove(entry.shadow)
              for (const material of entry.materials) {
                material.dispose()
              }
            }
            // Models load asynchronously, so a segment can swap from primitive to model.
            entry = createSegment(segment.slot, segment.partId)
            view.segments[index] = entry
            view.group.add(entry.node)
            view.group.add(entry.bones)
            view.group.add(entry.shadow)
            created = true
            // Swapping a placeholder for the real model is not a new part.
            pop = !upgraded
          }
          if (!entry) {
            continue
          }

          const remaining = segment.hurtUntil - world.time
          if (created) {
            entry.dead = segment.dead
            entry.dying = 0
            entry.exploded = true
            entry.spawnAge = segment.dead || !pop ? -1 : 0
          } else if (segment.dead && !entry.dead) {
            // The killing hit finishes its flash first; only then the part shrinks.
            entry.dead = true
            entry.dying = Math.max(0, remaining) + DESTROY_SEC
            entry.exploded = false
            entry.spawnAge = -1
          } else if (!segment.dead && entry.dead) {
            // A restored head or a regrown body pops back in.
            entry.dead = false
            entry.dying = 0
            entry.spawnAge = 0
          }

          if (entry.dying > 0) {
            entry.dying = Math.max(0, entry.dying - dt)
            if (!entry.exploded && entry.dying <= DESTROY_SEC) {
              effects.explode(segment.x, segment.z)
              entry.exploded = true
            }
          }
          if (entry.spawnAge >= 0) {
            entry.spawnAge += dt
            if (entry.spawnAge >= SPAWN_SEC) {
              entry.spawnAge = -1
            }
          }

          const showNode = !segment.dead || entry.dying > 0
          entry.node.visible = showNode
          entry.node.position.set(segment.x, entry.height, segment.z)
          entry.node.rotation.y = segment.angle
          if (showNode) {
            let scale = 1
            if (entry.dying > 0 && entry.dying <= DESTROY_SEC) {
              const shrink = 1 - entry.dying / DESTROY_SEC
              scale = 1 - shrink * shrink
            } else if (entry.spawnAge >= 0) {
              scale = spawnScale(entry.spawnAge)
            }
            entry.node.scale.copy(entry.baseScale).multiplyScalar(Math.max(0.001, scale))
          }
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
          entry.bones.visible = segment.dead && entry.dying <= 0
          entry.bones.position.set(segment.x, entry.model ? 0 : 0.8, segment.z)
          entry.bones.rotation.y = segment.angle
          entry.shadow.visible = true
          entry.shadow.position.set(segment.x, 0.02, segment.z)

          // One flash per hit, like the original.
          const flash = hurtFlash(remaining)
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
            entry.dead = true
            entry.dying = 0
            entry.spawnAge = -1
          }
        }
      }

      for (const [id, view] of views) {
        if (alive.has(id)) {
          continue
        }
        // An enemy leaves the snake list the tick it dies, so its remains play out here.
        if (view.alive) {
          view.alive = false
          startDeath(view)
        }
        if (!updateRemains(view, dt, effects)) {
          continue
        }
        for (const entry of view.segments) {
          entry.mixer?.stopAllAction()
          for (const material of entry.materials) {
            material.dispose()
          }
        }
        scene.remove(view.group)
        views.delete(id)
      }

      effects.update(dt)
    },
  }
}
