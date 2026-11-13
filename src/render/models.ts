import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { PARTS, getPart } from '@/content'
import { PART_LIFT } from '@/content/define'
import type { Slot } from '@/content/define'

/**
 * Source models are authored at the size they appear in the arena. The original
 * Unity prefabs scaled them down by four; this port keeps that authored size,
 * and gameplay distances scale with it instead.
 */

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
const clips = new Map<string, THREE.AnimationClip>()
const requests = new Map<string, Promise<void>>()
const boneTemplates = new Map<Slot, THREE.Group>()
const boneRequests = new Map<Slot, Promise<void>>()

export type PropId = 'apple' | 'powerup'

/** Scales and rotations copied from the Unity prop prefabs. */
const PROPS: Record<PropId, { scale: number; rotationX?: number; rotationY?: number }> = {
  apple: { scale: 0.75, rotationX: Math.PI / 2 },
  // The prefab is 0.45; doubled so the crate still reads at this camera distance.
  powerup: { scale: 0.9, rotationY: Math.PI },
}

const propTemplates = new Map<PropId, THREE.Group>()
const propRequests = new Map<PropId, Promise<void>>()

function modelId(slot: Slot, id: string): string {
  // Art offsets are per part, so two parts sharing one file are separate templates.
  return `${slot}:${id}`
}

/**
 * Places a part the way the original prefabs do: the pivot authored in the
 * model file stays the attachment point. Centring on the bounding box would
 * drag a head with long claws or antennae off that pivot, so the chain would
 * join it at the wrong spot, and every head would sit differently.
 */
function preparePart(
  root: THREE.Object3D,
  offset: readonly [number, number] = [0, 0],
): THREE.Group {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.material = partMaterial
    }
  })
  // The FBX export keeps the arbitrary object offset of the source scene in
  // the nodes under its RootNode; the original prefabs use the mesh alone, so
  // drop those offsets but keep the unit scale.
  for (const file of root.children) {
    for (const part of file.children.length > 0 ? file.children : [file]) {
      part.position.set(0, 0, 0)
    }
  }
  root.position.y = PART_LIFT

  const holder = new THREE.Group()
  holder.add(root)
  // Offsets are authored in the same units as the art.
  holder.position.set(offset[0], 0, offset[1])
  return holder
}

/** Centers the bone remains so they sit on the group origin. */
function normalize(root: THREE.Object3D): THREE.Group {
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
  return holder
}

/**
 * Map props keep the scale and rotation of their Unity prefabs. The geometry is
 * dropped onto y = 0, because the simulation only owns the XZ position.
 */
function prepareProp(root: THREE.Object3D, prop: PropId): THREE.Group {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.material = partMaterial
    }
  })
  const def = PROPS[prop]
  root.rotation.set(def.rotationX ?? 0, def.rotationY ?? 0, 0)
  root.scale.setScalar(def.scale)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  root.position.y -= box.min.y

  const holder = new THREE.Group()
  holder.add(root)
  return holder
}

function load(slot: Slot, id: string): Promise<void> {
  const key = modelId(slot, id)
  const running = requests.get(key)
  if (running) {
    return running
  }
  const part = getPart(slot, id)
  const model = part?.model ?? id
  const request = loader
    .loadAsync(`/assets/models/parts/${slot}/${model}.glb`)
    .then((gltf) => {
      templates.set(key, preparePart(gltf.scene, part?.offset))
      const clip = gltf.animations[0]
      if (clip) {
        // The source action opens with a lead-in before the walk cycle repeats,
        // so loop only the repeating part (24 fps, frames 20 to 60). The start
        // is half a frame early because glTF key times are float32.
        clips.set(key, THREE.AnimationUtils.subclip(clip, clip.name, 19.5, 61, 24))
      }
    })
    .catch(() => {
      // A missing model keeps the placeholder primitives instead of breaking the match.
    })
  requests.set(key, request)
  return request
}

/**
 * The bones the original leaves behind when a part explodes: a skull for the
 * head and a small bone for the body.
 */
function loadBones(slot: Slot): Promise<void> {
  const running = boneRequests.get(slot)
  if (running) {
    return running
  }
  const request = loader
    .loadAsync(`/assets/models/bones/${slot}.glb`)
    .then((gltf) => {
      boneTemplates.set(slot, normalize(gltf.scene))
    })
    .catch(() => {
      // Without bones the part simply disappears.
    })
  boneRequests.set(slot, request)
  return request
}

/** Returns the loaded model for a part, or undefined while it is still loading. */
export function getPartModel(slot: Slot, id: string): THREE.Group | undefined {
  return templates.get(modelId(slot, id))
}

/** The walk cycle some bodies ship with, if the source file has one. */
export function getPartClip(slot: Slot, id: string): THREE.AnimationClip | undefined {
  return clips.get(modelId(slot, id))
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
  void loadBones('head')
  void loadBones('body')
  void loadProp('apple')
  void loadProp('powerup')
}

/** Returns the bones of a slot, or undefined while they are still loading. */
export function getBonesModel(slot: Slot): THREE.Group | undefined {
  return boneTemplates.get(slot)
}

/** Copies the bones of a slot for one segment. */
export function cloneBonesModel(slot: Slot): THREE.Object3D | undefined {
  const template = boneTemplates.get(slot)
  return template ? cloneSkinned(template) : undefined
}

function loadProp(prop: PropId): Promise<void> {
  const running = propRequests.get(prop)
  if (running) {
    return running
  }
  const request = loader
    .loadAsync(`/assets/models/props/${prop}.glb`)
    .then((gltf) => {
      propTemplates.set(prop, prepareProp(gltf.scene, prop))
    })
    .catch(() => {
      // Without the model the prop keeps the primitive placeholder.
    })
  propRequests.set(prop, request)
  return request
}

export function getPropModel(prop: PropId): THREE.Group | undefined {
  return propTemplates.get(prop)
}

export function clonePropModel(prop: PropId): THREE.Object3D | undefined {
  const template = getPropModel(prop)
  return template ? cloneSkinned(template) : undefined
}
