import * as THREE from 'three'
import { clamp } from '@/core/math2d'
import { BALANCE } from '@/data/balance'
import { clonePartModel, clonePropModel, getPropModel } from './models'
import type { RenderPickup, RenderState } from './state'
import { getPartMaterial } from './snake-view'

const SHOT_COLORS: Record<string, string> = {
  bullet: '#ffd43b',
  poison: '#69db7c',
  lightning: '#74c0fc',
}

const AREA_COLORS: Record<string, string> = {
  poison: '#69db7c',
  lightning: '#74c0fc',
}

const shotGeometry = new THREE.SphereGeometry(BALANCE.projectileRadius, 8, 6)
const areaGeometry = new THREE.CircleGeometry(1, 24)
areaGeometry.rotateX(-Math.PI / 2)
const appleGeometry = new THREE.SphereGeometry(0.72, 10, 8)
const dropGeometry = new THREE.IcosahedronGeometry(0.8, 0)

const shotMaterials = new Map<string, THREE.MeshBasicMaterial>()
const areaMaterials = new Map<string, THREE.MeshBasicMaterial>()
const pickupMaterials = new Map<string, THREE.Material>()

function shotMaterial(visual: string): THREE.MeshBasicMaterial {
  const cached = shotMaterials.get(visual)
  if (cached) {
    return cached
  }
  const material = new THREE.MeshBasicMaterial({
    color: SHOT_COLORS[visual] ?? '#ffffff',
  })
  shotMaterials.set(visual, material)
  return material
}

function areaMaterial(partId: string): THREE.MeshBasicMaterial {
  const cached = areaMaterials.get(partId)
  if (cached) {
    return cached
  }
  const material = new THREE.MeshBasicMaterial({
    color: AREA_COLORS[partId] ?? '#ffa94d',
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  })
  areaMaterials.set(partId, material)
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
  const areas = new Map<string, THREE.Mesh>()
  const pickups = new Map<string, THREE.Object3D>()

  return {
    sync(world: RenderState): void {
      const seenShots = new Set<string>()
      for (const projectile of world.projectiles) {
        seenShots.add(projectile.id)
        let mesh = shots.get(projectile.id)
        if (!mesh) {
          mesh = new THREE.Mesh(shotGeometry, shotMaterial(projectile.visual))
          shots.set(projectile.id, mesh)
          scene.add(mesh)
        }
        mesh.material = shotMaterial(projectile.visual)
        mesh.position.set(projectile.x, projectile.y, projectile.z)
      }
      for (const [id, mesh] of shots) {
        if (!seenShots.has(id)) {
          scene.remove(mesh)
          shots.delete(id)
        }
      }

      const seenAreas = new Set<string>()
      for (const area of world.areas) {
        seenAreas.add(area.id)
        let mesh = areas.get(area.id)
        if (!mesh) {
          mesh = new THREE.Mesh(areaGeometry, areaMaterial(area.partId))
          areas.set(area.id, mesh)
          scene.add(mesh)
        }
        mesh.material = areaMaterial(area.partId)
        mesh.position.set(area.x, 0.05, area.z)
        mesh.scale.setScalar(area.radius)
      }
      for (const [id, mesh] of areas) {
        if (!seenAreas.has(id)) {
          scene.remove(mesh)
          areas.delete(id)
        }
      }

      const seenPickups = new Set<string>()
      for (const pickup of world.pickups) {
        seenPickups.add(pickup.id)
        let mesh = pickups.get(pickup.id)
        // The apple model can finish loading after the first apple spawned.
        const stale =
          pickup.kind === 'apple' &&
          !mesh?.userData.prop &&
          getPropModel('apple') !== undefined
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
    },
  }
}
