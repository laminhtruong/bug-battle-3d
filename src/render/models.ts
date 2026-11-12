import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { PARTS, getPart } from '@/content'
import type { Slot } from '@/content/define'

/**
 * Source models are authored at roughly four units per bug, while the arena
 * works in one-unit segments. One uniform scale keeps every part in proportion.
 */
const MODEL_SCALE = 0.3

/**
 * Parts share one 32x32 palette texture: their UVs point at flat colour swatches,
 * so a single material reproduces the original look without per-part textures.
 */
const atlas = new THREE.TextureLoader().load('/assets/textures/parts/bug-atlas.png')
atlas.colorSpace = THREE.SRGBColorSpace
// glTF UVs start at the top-left corner, so the image must not be flipped.
atlas.flipY = false
const partMaterial = new THREE.MeshToonMaterial({ map: atlas })

const loader = new GLTFLoader()
const templates = new Map<string, THREE.Group>()
const requests = new Map<string, Promise<void>>()

function modelId(slot: Slot, id: string): string {
  return `${slot}:${getPart(slot, id)?.model ?? id}`
}

function load(slot: Slot, id: string): Promise<void> {
  const key = modelId(slot, id)
  const running = requests.get(key)
  if (running) {
    return running
  }
  const model = getPart(slot, id)?.model ?? id
  const request = loader
    .loadAsync(`/assets/models/parts/${slot}/${model}.glb`)
    .then((gltf) => {
      const root = gltf.scene
      root.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.material = partMaterial
        }
      })
      // Source scenes scatter the parts far from the origin; bring the geometry
      // back to (0, ground, 0) so the simulation can own every position.
      const box = new THREE.Box3().setFromObject(root)
      const center = box.getCenter(new THREE.Vector3())
      root.position.set(-center.x, -box.min.y, -center.z)

      const holder = new THREE.Group()
      holder.add(root)
      holder.scale.setScalar(MODEL_SCALE)
      templates.set(key, holder)
    })
    .catch(() => {
      // A missing model keeps the placeholder primitives instead of breaking the match.
    })
  requests.set(key, request)
  return request
}

/** Returns the loaded model for a part, or undefined while it is still loading. */
export function getPartModel(slot: Slot, id: string): THREE.Group | undefined {
  return templates.get(modelId(slot, id))
}

/**
 * Copies a loaded model for one segment. Bodies are skinned, so they need
 * SkeletonUtils: a plain clone would keep pointing at the template's bones.
 */
export function clonePartModel(slot: Slot, id: string): THREE.Object3D | undefined {
  const template = getPartModel(slot, id)
  return template ? cloneSkinned(template) : undefined
}

/** Starts loading every registered part in the background, once per session. */
export function preloadPartModels(): void {
  for (const part of PARTS) {
    void load(part.slot, part.id)
  }
}
