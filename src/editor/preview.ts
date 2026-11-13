import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PART_LIFT, PART_SCALE, boxQuaternion } from '@/content/define'
import type { Slot } from '@/content/define'
import { BALANCE } from '@/data/balance'
import { createViewGizmo } from './gizmo'

export type Tool = 'move' | 'scale'

/** A collider box already scaled to arena units. */
export interface PreviewBox {
  x: number
  y: number
  z: number
  halfWidth: number
  halfHeight: number
  halfDepth: number
  /** Unity transform rotation in degrees, ZXY order. */
  rotation: [number, number, number]
  hitbox: boolean
}

/** A muzzle in raw prefab units, relative to the part pivot. */
export interface PreviewSpawn {
  x: number
  y: number
  z: number
  angle: number
}

export interface PreviewState {
  slot: Slot
  model: string
  /** Raw prefab units, applied to the art only. */
  offset: [number, number]
  boxes: PreviewBox[]
  selected: number
  spawns: PreviewSpawn[]
  selectedSpawn: number
  /** Drawn as a translucent sector around every muzzle for cone attacks. */
  cone?: { range: number; halfAngleDeg: number }
  showReference: boolean
  editColliders: boolean
}

export interface PreviewHandlers {
  onSelect(index: number): void
  onSelectSpawn(index: number): void
  /** Selected the part itself, so its arrows take over from any muzzle. */
  onSelectPart(): void
  onDragStart(): void
  onMove(index: number, x: number, y: number, z: number): void
  onScale(index: number, halfWidth: number, halfHeight: number, halfDepth: number): void
  /** Raw prefab offset for the art. */
  onOffset(x: number, z: number): void
  /** Raw prefab position for a muzzle. Y is visual only. */
  onSpawnMove(index: number, x: number, y: number, z: number): void
  onDragEnd(): void
}

export interface Preview {
  show(state: PreviewState): void
  select(index: number): void
  selectSpawn(index: number): void
  setTool(tool: Tool): void
  clear(): void
  dispose(): void
}

const HURT_COLOR = 0x4dd4ac
const HIT_COLOR = 0xff6b6b
const SELECTED_COLOR = 0xffd43b
const AXIS_X_COLOR = 0xff5a4d
const AXIS_Y_COLOR = 0x63c76a
const AXIS_Z_COLOR = 0x4d8dff
const CENTER_COLOR = 0xffd34d
const SPAWN_COLOR = 0xffa94d
const AXIS_X = new THREE.Vector3(1, 0, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)
const OFFSET_GIZMO_Y = 0.35
const SPAWN_RADIUS = 0.075

interface BoxEntry {
  mesh: THREE.Mesh
  edges: THREE.LineSegments
  halfWidth: number
  halfHeight: number
  halfDepth: number
  hitbox: boolean
}

interface SpawnEntry {
  group: THREE.Group
  mesh: THREE.Mesh
  line: THREE.Line
}

interface ConeEntry {
  group: THREE.Group
  mesh: THREE.Mesh
  line: THREE.Line
}

type Drag =
  | { kind: 'move'; index: number; dx: number; dz: number }
  | {
      kind: 'move-axis'
      index: number
      origin: THREE.Vector3
      axis: THREE.Vector3
      startT: number
    }
  | {
      kind: 'offset-axis'
      origin: THREE.Vector3
      axis: THREE.Vector3
      startT: number
    }
  | { kind: 'offset-free'; dx: number; dz: number }
  | { kind: 'spawn'; index: number; dx: number; dz: number }
  | {
      kind: 'spawn-axis'
      index: number
      origin: THREE.Vector3
      axis: THREE.Vector3
      startT: number
    }
  | {
      kind: 'scale'
      index: number
      startDistance: number
      startHalfWidth: number
      startHalfHeight: number
      startHalfDepth: number
    }
  | {
      kind: 'scale-axis'
      index: number
      mode: 'x' | 'y' | 'z'
      origin: THREE.Vector3
      axis: THREE.Vector3
      startT: number
      startHalfWidth: number
      startHalfHeight: number
      startHalfDepth: number
    }

/**
 * Copies the game's model placement so the editor shows the art and the
 * collider boxes in exactly the same space the simulation uses.
 */
function prepare(root: THREE.Object3D, material: THREE.Material): THREE.Group {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.material = material
    }
  })
  for (const file of root.children) {
    for (const part of file.children.length > 0 ? file.children : [file]) {
      part.position.set(0, 0, 0)
    }
  }
  root.position.y = PART_LIFT / PART_SCALE

  const holder = new THREE.Group()
  holder.add(root)
  holder.scale.setScalar(PART_SCALE)
  return holder
}

function makePlaceholder(slot: Slot): THREE.Group {
  const geometry =
    slot === 'head'
      ? new THREE.ConeGeometry(1.6, 4, 12).rotateX(Math.PI / 2)
      : new THREE.IcosahedronGeometry(1.2)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color: 0x8fa3b0 }))
  mesh.position.y = slot === 'head' ? 2 : 1.2
  const holder = new THREE.Group()
  holder.add(mesh)
  holder.scale.setScalar(PART_SCALE)
  return holder
}

export function createPreview(canvas: HTMLCanvasElement, handlers: PreviewHandlers): Preview {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#101c26')
  scene.add(new THREE.GridHelper(12, 24, 0x3b5b6b, 0x243440))
  scene.add(new THREE.AxesHelper(1.4))

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100)
  camera.position.set(2.6, 2.8, 3.6)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x456b4f, 2))
  const sun = new THREE.DirectionalLight(0xfff6e5, 2.2)
  sun.position.set(6, 10, 5)
  scene.add(sun)

  const atlas = new THREE.TextureLoader().load('/assets/textures/parts/bug-atlas.png')
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.flipY = false
  const partMaterial = new THREE.MeshToonMaterial({ map: atlas })
  const referenceMaterial = new THREE.MeshToonMaterial({
    map: atlas,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  })

  const loader = new GLTFLoader()
  const modelHolder = new THREE.Group()
  const referenceHolder = new THREE.Group()
  const boxGroup = new THREE.Group()
  const spawnGroup = new THREE.Group()
  const coneGroup = new THREE.Group()
  const gizmoGroup = new THREE.Group()
  const spawnGizmoGroup = new THREE.Group()
  referenceHolder.position.z = -BALANCE.headSpacing
  scene.add(
    modelHolder,
    referenceHolder,
    boxGroup,
    spawnGroup,
    coneGroup,
    gizmoGroup,
    spawnGizmoGroup,
  )

  let modelKey = ''
  let modelToken = 0
  let referenceLoaded = false
  let boxes: BoxEntry[] = []
  let spawns: SpawnEntry[] = []
  let cones: ConeEntry[] = []
  let selected = -1
  let selectedSpawn = -1
  let tool: Tool = 'move'
  let editColliders = false
  let drag: Drag | null = null
  let dragChanged = false
  const gizmoHandles: THREE.Mesh[] = []
  const spawnGizmoHandles: THREE.Mesh[] = []

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const dragPoint = new THREE.Vector3()

  function paint(): void {
    boxes.forEach((entry, index) => {
      const color = index === selected ? SELECTED_COLOR : entry.hitbox ? HIT_COLOR : HURT_COLOR
      const material = entry.mesh.material as THREE.MeshBasicMaterial
      material.color.setHex(color)
      material.opacity = index === selected ? 0.32 : 0.16
      const line = entry.edges.material as THREE.LineBasicMaterial
      line.color.setHex(color)
    })
  }

  function addGizmoHandle(
    geometry: THREE.BufferGeometry,
    color: number,
    handle: string,
    position: THREE.Vector3,
    opacity = 0.95,
    group: THREE.Group = gizmoGroup,
    handles: THREE.Mesh[] = gizmoHandles,
  ): void {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(position)
    mesh.renderOrder = 20
    mesh.userData.handle = handle
    group.add(mesh)
    handles.push(mesh)
  }

  /** Orange X/Z arrows on the selected muzzle, so a point can be nudged per axis. */
  function buildSpawnGizmo(): void {
    spawnGizmoGroup.clear()
    spawnGizmoHandles.length = 0
    addGizmoHandle(
      new THREE.CylinderGeometry(0.018, 0.018, 0.52, 8).rotateZ(-Math.PI / 2),
      SPAWN_COLOR,
      'spawn-x',
      new THREE.Vector3(0.26, 0, 0),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
    addGizmoHandle(
      new THREE.ConeGeometry(0.08, 0.2, 12).rotateZ(-Math.PI / 2),
      SPAWN_COLOR,
      'spawn-x',
      new THREE.Vector3(0.62, 0, 0),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
    addGizmoHandle(
      new THREE.CylinderGeometry(0.018, 0.018, 0.52, 8),
      SPAWN_COLOR,
      'spawn-y',
      new THREE.Vector3(0, 0.26, 0),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
    addGizmoHandle(
      new THREE.ConeGeometry(0.08, 0.2, 12),
      SPAWN_COLOR,
      'spawn-y',
      new THREE.Vector3(0, 0.62, 0),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
    addGizmoHandle(
      new THREE.CylinderGeometry(0.018, 0.018, 0.52, 8).rotateX(Math.PI / 2),
      SPAWN_COLOR,
      'spawn-z',
      new THREE.Vector3(0, 0, 0.26),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
    addGizmoHandle(
      new THREE.ConeGeometry(0.08, 0.2, 12).rotateX(Math.PI / 2),
      SPAWN_COLOR,
      'spawn-z',
      new THREE.Vector3(0, 0, 0.62),
      0.9,
      spawnGizmoGroup,
      spawnGizmoHandles,
    )
  }

  function buildGizmo(): void {
    gizmoGroup.clear()
    gizmoHandles.length = 0
    if (!editColliders) {
      addGizmoHandle(
        new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8).rotateZ(-Math.PI / 2),
        AXIS_X_COLOR,
        'move-x',
        new THREE.Vector3(0.36, 0, 0),
      )
      addGizmoHandle(
        new THREE.ConeGeometry(0.085, 0.24, 12).rotateZ(-Math.PI / 2),
        AXIS_X_COLOR,
        'move-x',
        new THREE.Vector3(0.84, 0, 0),
      )
      addGizmoHandle(
        new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8).rotateX(Math.PI / 2),
        AXIS_Z_COLOR,
        'move-z',
        new THREE.Vector3(0, 0, 0.36),
      )
      addGizmoHandle(
        new THREE.ConeGeometry(0.085, 0.24, 12).rotateX(Math.PI / 2),
        AXIS_Z_COLOR,
        'move-z',
        new THREE.Vector3(0, 0, 0.84),
      )
      addGizmoHandle(
        new THREE.BoxGeometry(0.13, 0.13, 0.13),
        CENTER_COLOR,
        'free-move',
        new THREE.Vector3(0, 0, 0),
      )
      return
    }
    if (tool === 'move') {
      addGizmoHandle(
        new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8).rotateZ(-Math.PI / 2),
        AXIS_X_COLOR,
        'move-x',
        new THREE.Vector3(0.36, 0, 0),
      )
      addGizmoHandle(
        new THREE.ConeGeometry(0.085, 0.24, 12).rotateZ(-Math.PI / 2),
        AXIS_X_COLOR,
        'move-x',
        new THREE.Vector3(0.84, 0, 0),
      )
      addGizmoHandle(
        new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8),
        AXIS_Y_COLOR,
        'move-y',
        new THREE.Vector3(0, 0.36, 0),
      )
      addGizmoHandle(
        new THREE.ConeGeometry(0.085, 0.24, 12),
        AXIS_Y_COLOR,
        'move-y',
        new THREE.Vector3(0, 0.84, 0),
      )
      addGizmoHandle(
        new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8).rotateX(Math.PI / 2),
        AXIS_Z_COLOR,
        'move-z',
        new THREE.Vector3(0, 0, 0.36),
      )
      addGizmoHandle(
        new THREE.ConeGeometry(0.085, 0.24, 12).rotateX(Math.PI / 2),
        AXIS_Z_COLOR,
        'move-z',
        new THREE.Vector3(0, 0, 0.84),
      )
      addGizmoHandle(
        new THREE.BoxGeometry(0.13, 0.13, 0.13),
        CENTER_COLOR,
        'free-move',
        new THREE.Vector3(0, 0, 0),
      )
      return
    }
    addGizmoHandle(
      new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6).rotateZ(-Math.PI / 2),
      AXIS_X_COLOR,
      'scale-x',
      new THREE.Vector3(0.4, 0, 0),
    )
    addGizmoHandle(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      AXIS_X_COLOR,
      'scale-x',
      new THREE.Vector3(0.9, 0, 0),
    )
    addGizmoHandle(
      new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6),
      AXIS_Y_COLOR,
      'scale-y',
      new THREE.Vector3(0, 0.4, 0),
    )
    addGizmoHandle(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      AXIS_Y_COLOR,
      'scale-y',
      new THREE.Vector3(0, 0.9, 0),
    )
    addGizmoHandle(
      new THREE.CylinderGeometry(0.012, 0.012, 0.8, 6).rotateX(Math.PI / 2),
      AXIS_Z_COLOR,
      'scale-z',
      new THREE.Vector3(0, 0, 0.4),
    )
    addGizmoHandle(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      AXIS_Z_COLOR,
      'scale-z',
      new THREE.Vector3(0, 0, 0.9),
    )
    addGizmoHandle(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      CENTER_COLOR,
      'scale-free',
      new THREE.Vector3(0, 0, 0),
    )
  }

  function updateGizmoTransform(): void {
    if (!editColliders) {
      // The muzzle arrows take over while a spawn point is selected.
      gizmoGroup.visible = modelHolder.children.length > 0 && selectedSpawn < 0
      gizmoGroup.position.set(modelHolder.position.x, OFFSET_GIZMO_Y, modelHolder.position.z)
      const distance = camera.position.distanceTo(gizmoGroup.position)
      gizmoGroup.scale.setScalar(THREE.MathUtils.clamp(distance * 0.16, 0.35, 1.6))
      return
    }
    const entry = boxes[selected]
    if (!entry) {
      gizmoGroup.visible = false
      return
    }
    gizmoGroup.visible = true
    gizmoGroup.position.copy(entry.mesh.position)
    const distance = camera.position.distanceTo(entry.mesh.position)
    gizmoGroup.scale.setScalar(THREE.MathUtils.clamp(distance * 0.16, 0.35, 1.6))
  }

  function updateSpawnGizmoTransform(): void {
    const entry = spawns[selectedSpawn]
    spawnGizmoGroup.visible = !editColliders && entry !== undefined
    if (!entry) {
      return
    }
    spawnGizmoGroup.position.copy(entry.group.position)
    const distance = camera.position.distanceTo(entry.group.position)
    spawnGizmoGroup.scale.setScalar(THREE.MathUtils.clamp(distance * 0.14, 0.3, 1.4))
  }

  function axisParameter(ray: THREE.Ray, origin: THREE.Vector3, axis: THREE.Vector3): number {
    const start = origin.clone().addScaledVector(axis, -100)
    const end = origin.clone().addScaledVector(axis, 100)
    const point = new THREE.Vector3()
    ray.distanceSqToSegment(start, end, undefined, point)
    return point.sub(origin).dot(axis)
  }

  function setModel(slot: Slot, model: string): void {
    const key = `${slot}:${model}`
    if (key === modelKey) {
      return
    }
    modelKey = key
    const token = ++modelToken
    modelHolder.clear()
    loader
      .loadAsync(`/assets/models/parts/${slot}/${model}.glb`)
      .then((gltf) => {
        if (token === modelToken) {
          modelHolder.add(prepare(gltf.scene, partMaterial))
        }
      })
      .catch(() => {
        if (token === modelToken) {
          modelHolder.add(makePlaceholder(slot))
        }
      })
  }

  function setReference(visible: boolean, slot: Slot): void {
    referenceHolder.visible = visible && slot === 'head'
    if (!referenceHolder.visible || referenceLoaded) {
      return
    }
    referenceLoaded = true
    loader
      .loadAsync('/assets/models/parts/body/normal.glb')
      .then((gltf) => {
        referenceHolder.add(prepare(gltf.scene, referenceMaterial))
      })
      .catch(() => {
        referenceLoaded = false
      })
  }

  function rebuildBoxes(state: PreviewState): void {
    boxGroup.clear()
    boxes = state.boxes.map((box, index) => {
      const geometry = new THREE.BoxGeometry(
        box.halfWidth * 2,
        box.halfHeight * 2,
        box.halfDepth * 2,
      )
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        depthTest: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(box.x, box.y, box.z)
      const [qx, qy, qz, qw] = boxQuaternion(box.rotation)
      mesh.quaternion.set(qx, qy, qz, qw)
      mesh.userData.index = index
      mesh.renderOrder = 10
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ depthTest: false }),
      )
      edges.renderOrder = 11
      boxGroup.add(mesh)
      return {
        mesh,
        edges,
        halfWidth: box.halfWidth,
        halfHeight: box.halfHeight,
        halfDepth: box.halfDepth,
        hitbox: box.hitbox,
      }
    })
    // Edges are children of the mesh only in the scene graph, so dragging one moves both.
    for (const entry of boxes) {
      entry.mesh.add(entry.edges)
    }
    selected = Math.min(state.selected, boxes.length - 1)
    paint()
  }

  function paintSpawns(): void {
    const paint = (mesh: THREE.Mesh, line: THREE.Line, selected: boolean): void => {
      const color = selected ? SELECTED_COLOR : SPAWN_COLOR
      ;(mesh.material as THREE.MeshBasicMaterial).color.setHex(color)
      ;(line.material as THREE.LineBasicMaterial).color.setHex(color)
    }
    spawns.forEach((entry, index) => paint(entry.mesh, entry.line, index === selectedSpawn))
    cones.forEach((entry, index) => {
      paint(entry.mesh, entry.line, index === selectedSpawn)
      ;(entry.mesh.material as THREE.MeshBasicMaterial).opacity =
        index === selectedSpawn ? 0.18 : 0.09
    })
  }

  function rebuildSpawns(state: PreviewState): void {
    spawnGroup.clear()
    spawns = state.spawns.map((spawn, index) => {
      const group = new THREE.Group()
      group.position.set(spawn.x * PART_SCALE, spawn.y * PART_SCALE, spawn.z * PART_SCALE)
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(SPAWN_RADIUS, 12, 10),
        new THREE.MeshBasicMaterial({
          color: SPAWN_COLOR,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }),
      )
      mesh.renderOrder = 18
      mesh.userData.spawnIndex = index
      const radians = (spawn.angle * Math.PI) / 180
      const direction = new THREE.Vector3(Math.sin(radians), 0, Math.cos(radians)).multiplyScalar(
        0.32,
      )
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), direction]),
        new THREE.LineBasicMaterial({ color: SPAWN_COLOR, depthTest: false }),
      )
      line.renderOrder = 17
      group.add(mesh, line)
      spawnGroup.add(group)
      return { group, mesh, line }
    })
    selectedSpawn = spawns.length === 0 ? -1 : Math.min(state.selectedSpawn, spawns.length - 1)
    paintSpawns()
  }

  function coneOutline(radius: number, halfAngle: number): THREE.Vector3[] {
    const points = [new THREE.Vector3()]
    for (let step = 0; step <= 24; step += 1) {
      const angle = -halfAngle + (halfAngle * 2 * step) / 24
      points.push(new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius))
    }
    points.push(new THREE.Vector3())
    return points
  }

  function rebuildCones(state: PreviewState): void {
    coneGroup.clear()
    cones = []
    if (!state.cone) {
      return
    }
    const halfAngle = (state.cone.halfAngleDeg * Math.PI) / 180
    // Range is authored in arena units, like the simulation uses it.
    const radius = state.cone.range
    cones = state.spawns.map((spawn) => {
      const group = new THREE.Group()
      group.position.set(spawn.x * PART_SCALE, spawn.y * PART_SCALE, spawn.z * PART_SCALE)
      group.rotation.y = (spawn.angle * Math.PI) / 180
      const geometry = new THREE.CircleGeometry(
        radius,
        32,
        -Math.PI / 2 - halfAngle,
        halfAngle * 2,
      ).rotateX(-Math.PI / 2)
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: SPAWN_COLOR,
          transparent: true,
          opacity: 0.09,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      )
      mesh.renderOrder = 5
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(coneOutline(radius, halfAngle)),
        new THREE.LineBasicMaterial({
          color: SPAWN_COLOR,
          transparent: true,
          opacity: 0.75,
          depthTest: false,
        }),
      )
      line.renderOrder = 6
      group.add(mesh, line)
      coneGroup.add(group)
      return { group, mesh, line }
    })
    paintSpawns()
  }

  function placeSpawn(index: number, x: number, y: number, z: number): void {
    const entry = spawns[index]
    if (!entry) {
      return
    }
    entry.group.position.set(x, y, z)
    const cone = cones[index]
    if (cone) {
      cone.group.position.set(x, y, z)
    }
    markDragStart()
    handlers.onSpawnMove(index, x / PART_SCALE, y / PART_SCALE, z / PART_SCALE)
  }

  function setPointer(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
  }

  function setDragPlane(y: number): void {
    dragPlane.constant = -y
  }

  const boxMeshes = (): THREE.Object3D[] => boxes.map((entry) => entry.mesh)

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    setPointer(event)
    const spawnGizmoHit = spawnGizmoGroup.visible
      ? raycaster.intersectObjects(spawnGizmoHandles, false)[0]
      : undefined
    if (spawnGizmoHit) {
      const handle = spawnGizmoHit.object.userData.handle as string
      const entry = spawns[selectedSpawn]
      if (!entry) {
        return
      }
      const axis = handle === 'spawn-x' ? AXIS_X : handle === 'spawn-y' ? AXIS_Y : AXIS_Z
      const origin = entry.group.position.clone()
      dragChanged = false
      drag = {
        kind: 'spawn-axis',
        index: selectedSpawn,
        origin,
        axis,
        startT: axisParameter(raycaster.ray, origin, axis),
      }
      controls.enabled = false
      canvas.setPointerCapture(event.pointerId)
      event.stopImmediatePropagation()
      return
    }
    const gizmoHit = gizmoGroup.visible
      ? raycaster.intersectObjects(gizmoHandles, false)[0]
      : undefined
    if (gizmoHit) {
      const handle = gizmoHit.object.userData.handle as string
      dragChanged = false
      if (!editColliders) {
        const origin = new THREE.Vector3(
          modelHolder.position.x,
          OFFSET_GIZMO_Y,
          modelHolder.position.z,
        )
        if (handle === 'move-x' || handle === 'move-z') {
          const axis = handle === 'move-x' ? AXIS_X : AXIS_Z
          drag = {
            kind: 'offset-axis',
            origin,
            axis,
            startT: axisParameter(raycaster.ray, origin, axis),
          }
        } else {
          setDragPlane(OFFSET_GIZMO_Y)
          if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
            return
          }
          drag = {
            kind: 'offset-free',
            dx: origin.x - dragPoint.x,
            dz: origin.z - dragPoint.z,
          }
        }
        controls.enabled = false
        canvas.setPointerCapture(event.pointerId)
        event.stopImmediatePropagation()
        return
      }
      const entry = boxes[selected]
      if (!entry) {
        return
      }
      const mesh = entry.mesh
      if (handle === 'move-x' || handle === 'move-y' || handle === 'move-z') {
        const axis = handle === 'move-x' ? AXIS_X : handle === 'move-y' ? AXIS_Y : AXIS_Z
        const origin = mesh.position.clone()
        drag = {
          kind: 'move-axis',
          index: selected,
          origin,
          axis,
          startT: axisParameter(raycaster.ray, origin, axis),
        }
      } else if (handle.startsWith('scale-') && handle !== 'scale-free') {
        const mode = handle === 'scale-x' ? 'x' : handle === 'scale-y' ? 'y' : 'z'
        const axis = mode === 'x' ? AXIS_X : mode === 'y' ? AXIS_Y : AXIS_Z
        const origin = mesh.position.clone()
        const startT = axisParameter(raycaster.ray, origin, axis)
        if (Math.abs(startT) < 1e-3) {
          return
        }
        drag = {
          kind: 'scale-axis',
          index: selected,
          mode,
          origin,
          axis,
          startT,
          startHalfWidth: entry.halfWidth,
          startHalfHeight: entry.halfHeight,
          startHalfDepth: entry.halfDepth,
        }
      } else {
        setDragPlane(mesh.position.y)
        if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
          return
        }
        if (handle === 'free-move') {
          drag = {
            kind: 'move',
            index: selected,
            dx: mesh.position.x - dragPoint.x,
            dz: mesh.position.z - dragPoint.z,
          }
        } else {
          const distance = Math.hypot(dragPoint.x - mesh.position.x, dragPoint.z - mesh.position.z)
          if (distance < 1e-3) {
            return
          }
          drag = {
            kind: 'scale',
            index: selected,
            startDistance: distance,
            startHalfWidth: entry.halfWidth,
            startHalfHeight: entry.halfHeight,
            startHalfDepth: entry.halfDepth,
          }
        }
      }
      controls.enabled = false
      canvas.setPointerCapture(event.pointerId)
      event.stopImmediatePropagation()
      return
    }

    const spawnHit =
      spawns.length > 0
        ? raycaster.intersectObjects(
            spawns.map((entry) => entry.mesh),
            false,
          )[0]
        : undefined
    if (spawnHit) {
      const index = spawnHit.object.userData.spawnIndex as number
      const entry = spawns[index]
      if (!entry) {
        return
      }
      selectedSpawn = index
      paintSpawns()
      handlers.onSelectSpawn(index)
      setDragPlane(entry.group.position.y)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        return
      }
      dragChanged = false
      drag = {
        kind: 'spawn',
        index,
        dx: entry.group.position.x - dragPoint.x,
        dz: entry.group.position.z - dragPoint.z,
      }
      controls.enabled = false
      canvas.setPointerCapture(event.pointerId)
      event.stopImmediatePropagation()
      return
    }

    if (!editColliders) {
      // Clicking the art selects the part, which shows its own arrows.
      if (raycaster.intersectObject(modelHolder, true)[0]) {
        selectedSpawn = -1
        paintSpawns()
        handlers.onSelectPart()
      }
      return
    }

    const hit = raycaster.intersectObjects(boxMeshes(), false)[0]
    if (!hit) {
      return
    }
    const mesh = hit.object as THREE.Mesh
    const index = mesh.userData.index as number
    const entry = boxes[index]
    if (!entry) {
      return
    }
    selected = index
    paint()
    handlers.onSelect(index)
    setDragPlane(mesh.position.y)
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return
    }
    dragChanged = false
    const dx = dragPoint.x - mesh.position.x
    const dz = dragPoint.z - mesh.position.z
    if (tool === 'move') {
      drag = {
        kind: 'move',
        index,
        dx: mesh.position.x - dragPoint.x,
        dz: mesh.position.z - dragPoint.z,
      }
    } else {
      const distance = Math.hypot(dx, dz)
      if (distance < 1e-3) {
        return
      }
      drag = {
        kind: 'scale',
        index,
        startDistance: distance,
        startHalfWidth: entry.halfWidth,
        startHalfHeight: entry.halfHeight,
        startHalfDepth: entry.halfDepth,
      }
    }
    controls.enabled = false
    canvas.setPointerCapture(event.pointerId)
    // The handler is registered before OrbitControls, so this stops the camera.
    event.stopImmediatePropagation()
  }

  function markDragStart(): void {
    if (dragChanged) {
      return
    }
    dragChanged = true
    handlers.onDragStart()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag) {
      return
    }
    setPointer(event)
    if (drag.kind === 'offset-axis') {
      const t = axisParameter(raycaster.ray, drag.origin, drag.axis)
      const position = drag.origin.clone().addScaledVector(drag.axis, t - drag.startT)
      modelHolder.position.x = position.x
      modelHolder.position.z = position.z
      markDragStart()
      handlers.onOffset(modelHolder.position.x / PART_SCALE, modelHolder.position.z / PART_SCALE)
      return
    }
    if (drag.kind === 'offset-free') {
      setDragPlane(OFFSET_GIZMO_Y)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        return
      }
      modelHolder.position.x = dragPoint.x + drag.dx
      modelHolder.position.z = dragPoint.z + drag.dz
      markDragStart()
      handlers.onOffset(modelHolder.position.x / PART_SCALE, modelHolder.position.z / PART_SCALE)
      return
    }
    if (drag.kind === 'spawn') {
      const entry = spawns[drag.index]
      if (!entry) {
        return
      }
      setDragPlane(entry.group.position.y)
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        return
      }
      placeSpawn(drag.index, dragPoint.x + drag.dx, entry.group.position.y, dragPoint.z + drag.dz)
      return
    }
    if (drag.kind === 'spawn-axis') {
      const t = axisParameter(raycaster.ray, drag.origin, drag.axis)
      const position = drag.origin.clone().addScaledVector(drag.axis, t - drag.startT)
      placeSpawn(drag.index, position.x, position.y, position.z)
      return
    }
    const entry = boxes[drag.index]
    if (!entry) {
      return
    }
    const mesh = entry.mesh
    if (drag.kind === 'move-axis') {
      const t = axisParameter(raycaster.ray, drag.origin, drag.axis)
      mesh.position.copy(drag.origin).addScaledVector(drag.axis, t - drag.startT)
      markDragStart()
      handlers.onMove(drag.index, mesh.position.x, mesh.position.y, mesh.position.z)
      return
    }
    if (drag.kind === 'scale-axis') {
      const t = axisParameter(raycaster.ray, drag.origin, drag.axis)
      const factor = Math.max(0.05, Math.abs(t) / Math.abs(drag.startT))
      if (drag.mode === 'x') {
        mesh.scale.set(factor, 1, 1)
      } else if (drag.mode === 'y') {
        mesh.scale.set(1, factor, 1)
      } else {
        mesh.scale.set(1, 1, factor)
      }
      markDragStart()
      handlers.onScale(
        drag.index,
        drag.mode === 'x' ? drag.startHalfWidth * factor : drag.startHalfWidth,
        drag.mode === 'y' ? drag.startHalfHeight * factor : drag.startHalfHeight,
        drag.mode === 'z' ? drag.startHalfDepth * factor : drag.startHalfDepth,
      )
      return
    }
    setDragPlane(mesh.position.y)
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
      return
    }
    if (drag.kind === 'move') {
      mesh.position.x = dragPoint.x + drag.dx
      mesh.position.z = dragPoint.z + drag.dz
      markDragStart()
      handlers.onMove(drag.index, mesh.position.x, mesh.position.y, mesh.position.z)
      return
    }
    const distance = Math.hypot(dragPoint.x - mesh.position.x, dragPoint.z - mesh.position.z)
    const factor = Math.max(0.05, distance / drag.startDistance)
    mesh.scale.set(factor, factor, factor)
    markDragStart()
    handlers.onScale(
      drag.index,
      drag.startHalfWidth * factor,
      drag.startHalfHeight * factor,
      drag.startHalfDepth * factor,
    )
  }

  function onPointerUp(): void {
    if (!drag) {
      return
    }
    if (dragChanged) {
      handlers.onDragEnd()
    }
    drag = null
    dragChanged = false
    controls.enabled = true
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  const controls = new OrbitControls(camera, canvas)
  controls.target.set(0, 0.3, 0.2)
  controls.enableDamping = true
  controls.minDistance = 1.2
  controls.maxDistance = 12
  // Unity lets you look from below too; the orientation gizmo snaps to that.
  controls.maxPolarAngle = Math.PI - 0.02
  controls.update()

  const gizmo = createViewGizmo(canvas.parentElement ?? document.body, camera, controls)

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  const resize = (): void => {
    const width = canvas.clientWidth || 1
    const height = canvas.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  buildGizmo()
  buildSpawnGizmo()

  renderer.setAnimationLoop(() => {
    controls.update()
    updateGizmoTransform()
    updateSpawnGizmoTransform()
    renderer.render(scene, camera)
    gizmo.update()
  })

  return {
    show(state) {
      editColliders = state.editColliders
      boxGroup.visible = editColliders
      setModel(state.slot, state.model)
      modelHolder.position.set(state.offset[0] * PART_SCALE, 0, state.offset[1] * PART_SCALE)
      setReference(state.showReference, state.slot)
      rebuildBoxes(state)
      rebuildSpawns(state)
      rebuildCones(state)
      buildGizmo()
      updateGizmoTransform()
      updateSpawnGizmoTransform()
    },
    select(index) {
      selected = Math.min(index, boxes.length - 1)
      paint()
      updateGizmoTransform()
    },
    selectSpawn(index) {
      selectedSpawn = index < 0 || spawns.length === 0 ? -1 : Math.min(index, spawns.length - 1)
      paintSpawns()
      updateGizmoTransform()
      updateSpawnGizmoTransform()
    },
    setTool(next) {
      tool = next
      buildGizmo()
      updateGizmoTransform()
    },
    clear() {
      modelToken += 1
      modelKey = ''
      modelHolder.clear()
      referenceHolder.visible = false
      boxGroup.clear()
      spawnGroup.clear()
      coneGroup.clear()
      boxes = []
      spawns = []
      cones = []
      selectedSpawn = -1
      gizmoGroup.visible = false
      spawnGizmoGroup.visible = false
    },
    dispose() {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      gizmo.dispose()
      controls.dispose()
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      renderer.dispose()
    },
  }
}
