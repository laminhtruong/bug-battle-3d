import * as THREE from 'three'
import { requirePart } from '@/content'
import { clamp } from '@/core/math2d'
import { BALANCE } from '@/data/balance'
import { clonePartModel, clonePropModel, getPropModel } from './models'
import { createParticles } from './particles'
import type { RenderPickup, RenderState } from './state'
import { getPartMaterial } from './snake-view'

const SHOT_STYLES: Record<string, { color: string; radius: number }> = {
  // Bullet prefabs: a built-in sphere with the part's flat material colour.
  bullet: { color: '#4ddef2', radius: 0.4 },
  lightning: { color: '#fd5cfd', radius: 0.467 },
  poison: { color: '#00e501', radius: 0.467 },
}

const shotGeometry = new THREE.SphereGeometry(1, 12, 8)
const appleGeometry = new THREE.SphereGeometry(0.72, 10, 8)
const dropGeometry = new THREE.IcosahedronGeometry(0.8, 0)

const shotMaterials = new Map<string, THREE.MeshBasicMaterial>()
const pickupMaterials = new Map<string, THREE.Material>()

function shotMaterial(visual: string): THREE.MeshBasicMaterial {
  const cached = shotMaterials.get(visual)
  if (cached) {
    return cached
  }
  const material = new THREE.MeshBasicMaterial({
    color: SHOT_STYLES[visual]?.color ?? '#ffffff',
  })
  shotMaterials.set(visual, material)
  return material
}

function pickupMaterial(pickup: RenderPickup): THREE.Material {
  const key = `${pickup.kind}:${pickup.partId ?? ''}`
  const cached = pickupMaterials.get(key)
  if (cached) {
    return cached
  }
  const material =
    pickup.kind === 'head' || pickup.kind === 'body'
      ? getPartMaterial(pickup.kind, pickup.partId ?? 'normal')
      : new THREE.MeshToonMaterial({
          color: pickup.kind === 'apple' ? '#ff4d4d' : '#f8f9fa',
        })
  pickupMaterials.set(key, material)
  return material
}

function pickupGeometry(pickup: RenderPickup): THREE.BufferGeometry {
  return pickup.kind === 'apple' ? appleGeometry : dropGeometry
}

/** Part drops wear their real model once it has loaded; otherwise a placeholder. */
function pickupObject(pickup: RenderPickup): THREE.Object3D {
  if (pickup.kind === 'apple') {
    const model = clonePropModel('apple')
    if (model) {
      model.userData.prop = true
      return model
    }
  }
  if (pickup.kind === 'head' || pickup.kind === 'body') {
    const model = clonePartModel(pickup.kind, pickup.partId ?? 'normal')
    if (model) {
      model.scale.multiplyScalar(0.8)
      return model
    }
  }
  return new THREE.Mesh(pickupGeometry(pickup), pickupMaterial(pickup))
}

/** 0 while the loot sits in the crate, 1 once it has landed. */
function flightProgress(pickup: RenderPickup, time: number): number {
  if (pickup.fromX === undefined || pickup.fromZ === undefined || pickup.landAt === undefined) {
    return 1
  }
  const launchedAt = pickup.landAt - BALANCE.powerupDropFlightSec
  return clamp((time - launchedAt) / BALANCE.powerupDropFlightSec, 0, 1)
}

export function createPropViewer(scene: THREE.Scene) {
  const shots = new Map<string, THREE.Mesh>()
  const pickups = new Map<string, THREE.Object3D>()
  const particles = createParticles(scene)
  const cooldowns = new Map<string, number>()
  // One parent per segment, so the flames follow the part instead of the floor.
  const fireAnchors = new Map<string, THREE.Object3D>()
  const seenAreas = new Set<string>()
  let lastTime = 0

  function fireAnchor(key: string): THREE.Object3D {
    let anchor = fireAnchors.get(key)
    if (!anchor) {
      anchor = new THREE.Group()
      scene.add(anchor)
      fireAnchors.set(key, anchor)
    }
    return anchor
  }

  /** Fires the flame burst the tick a cone part's cooldown wraps. */
  function syncFlames(world: RenderState): void {
    const seen = new Set<string>()
    for (const snake of world.snakes) {
      for (let index = 0; index < snake.segments.length; index += 1) {
        const segment = snake.segments[index]!
        if (segment.dead) {
          continue
        }
        const part = requirePart(segment.slot, segment.partId)
        const attack = part.attack
        if (!attack || attack.kind !== 'cone') {
          continue
        }
        const key = `${snake.id}:${index}`
        seen.add(key)
        const anchor = fireAnchor(key)
        anchor.position.set(segment.x, 0, segment.z)
        anchor.rotation.y = segment.angle
        const previous = cooldowns.get(key)
        cooldowns.set(key, segment.cooldown)
        if (previous === undefined || segment.cooldown <= previous) {
          continue
        }
        for (const spawn of attack.cone.spawnPoints) {
          const angle = (spawn.angle * Math.PI) / 180
          if (segment.slot === 'head') {
            particles.flameHead(anchor, spawn.x, spawn.y, spawn.z, angle)
          } else {
            particles.flameBody(anchor, spawn.x, spawn.y, spawn.z, angle)
          }
        }
      }
    }
    for (const key of cooldowns.keys()) {
      if (!seen.has(key)) {
        cooldowns.delete(key)
      }
    }
    for (const [key, anchor] of fireAnchors) {
      if (!seen.has(key)) {
        // Flames still playing keep their last pose and fade out on their own.
        scene.remove(anchor)
        fireAnchors.delete(key)
      }
    }
  }

  return {
    sync(world: RenderState, dt = 0): void {
      // A new match restarts the clock and reuses entity ids.
      if (world.time < lastTime) {
        cooldowns.clear()
        seenAreas.clear()
        for (const anchor of fireAnchors.values()) {
          scene.remove(anchor)
        }
        fireAnchors.clear()
      }
      lastTime = world.time
      syncFlames(world)

      const seenShots = new Set<string>()
      for (const projectile of world.projectiles) {
        seenShots.add(projectile.id)
        let mesh = shots.get(projectile.id)
        if (!mesh) {
          mesh = new THREE.Mesh(shotGeometry, shotMaterial(projectile.visual))
          mesh.scale.setScalar(SHOT_STYLES[projectile.visual]?.radius ?? 0.5)
          shots.set(projectile.id, mesh)
          scene.add(mesh)
        }
        mesh.material = shotMaterial(projectile.visual)
        mesh.position.set(projectile.x, projectile.y, projectile.z)
        particles.shot(projectile.id, projectile.visual, projectile.x, projectile.y, projectile.z)
      }
      for (const [id, mesh] of shots) {
        if (!seenShots.has(id)) {
          scene.remove(mesh)
          shots.delete(id)
          particles.dropShot(id)
        }
      }

      const liveAreas = new Set<string>()
      for (const area of world.areas) {
        liveAreas.add(area.id)
        if (seenAreas.has(area.id)) {
          continue
        }
        seenAreas.add(area.id)
        if (area.partId === 'lightning' || area.partId === 'poison') {
          particles.impact(area.partId, area.x, 0.5, area.z)
        }
      }
      for (const id of seenAreas) {
        if (!liveAreas.has(id)) {
          seenAreas.delete(id)
        }
      }

      const seenPickups = new Set<string>()
      for (const pickup of world.pickups) {
        seenPickups.add(pickup.id)
        let mesh = pickups.get(pickup.id)
        // The apple model can finish loading after the first apple spawned.
        const stale =
          pickup.kind === 'apple' && !mesh?.userData.prop && getPropModel('apple') !== undefined
        if (mesh && stale) {
          scene.remove(mesh)
          mesh = undefined
        }
        if (!mesh) {
          mesh = pickupObject(pickup)
          pickups.set(pickup.id, mesh)
          scene.add(mesh)
        }
        const bob = Math.sin(world.time * 3 + pickup.x + pickup.z) * 0.32
        // The apple model stands on its own pivot; part drops are centred meshes.
        const lift = pickup.kind === 'apple' ? 0.45 : 1.28
        const progress = flightProgress(pickup, world.time)
        const fromX = pickup.fromX ?? pickup.x
        const fromZ = pickup.fromZ ?? pickup.z
        const x = fromX + (pickup.x - fromX) * progress
        const z = fromZ + (pickup.z - fromZ) * progress
        // The loot hops up and drops onto its landing spot.
        const hop = Math.sin(Math.PI * progress) * BALANCE.powerupDropHeight
        mesh.position.set(x, lift + bob + hop, z)
        mesh.rotation.y = world.time * 2
      }
      for (const [id, mesh] of pickups) {
        if (!seenPickups.has(id)) {
          scene.remove(mesh)
          pickups.delete(id)
        }
      }

      particles.update(dt)
    },
  }
}
