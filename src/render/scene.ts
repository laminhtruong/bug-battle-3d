import * as THREE from 'three'
import { classicArena } from '@/content'

export interface View {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  render(): void
  updateCamera(x: number, z: number, dt: number): void
}

/**
 * The in-game rig of the original, scaled to the native-size art: the camera
 * sits four times farther so a part keeps the on-screen size it had when the
 * prefabs were shrunk to a quarter. The pitch stays at the original 75 degrees.
 * The menu rig sits lower at 45 degrees, which is what this view used to show.
 */
const CAMERA_OFFSET = new THREE.Vector3(0, 40, -14)
const CAMERA_AIM = new THREE.Vector3(
  0,
  -Math.sin(THREE.MathUtils.degToRad(75)),
  Math.cos(THREE.MathUtils.degToRad(75)),
)

export function createView(canvas: HTMLCanvasElement): View {
  const arena = classicArena
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#8ed0f0')
  scene.fog = new THREE.Fog('#8ed0f0', 168, 360)

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400)
  camera.position.copy(CAMERA_OFFSET)
  // The pitch is fixed, so aim once along it instead of at the focus each frame.
  camera.lookAt(camera.position.clone().add(CAMERA_AIM))

  const hemisphere = new THREE.HemisphereLight('#ffffff', '#456b4f', 2)
  scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#fff6e5', 2.4)
  sun.position.set(12, 24, 8)
  scene.add(sun)

  const floorTexture = new THREE.TextureLoader().load(
    `/assets/textures/arenas/${arena.id}/floor-base.png`,
  )
  floorTexture.colorSpace = THREE.SRGBColorSpace
  floorTexture.wrapS = THREE.RepeatWrapping
  floorTexture.wrapT = THREE.RepeatWrapping
  // One texture tile covers four world units, so the paving stones stay readable.
  floorTexture.repeat.set(arena.width / 4, arena.depth / 4)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(arena.width, arena.depth),
    new THREE.MeshBasicMaterial({ map: floorTexture }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const wallMaterial = new THREE.MeshToonMaterial({ color: '#3f7d52' })
  const wallHeight = 0.6
  const halfWidth = arena.width / 2
  const halfDepth = arena.depth / 2
  const walls: [number, number, number, number][] = [
    [0, -halfDepth, arena.width, 0.4],
    [0, halfDepth, arena.width, 0.4],
    [-halfWidth, 0, 0.4, arena.depth],
    [halfWidth, 0, 0.4, arena.depth],
  ]
  for (const [x, z, sizeX, sizeZ] of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sizeX, wallHeight, sizeZ), wallMaterial)
    wall.position.set(x, wallHeight / 2, z)
    scene.add(wall)
  }

  const focus = new THREE.Vector3(0, 0, 0)
  const desired = new THREE.Vector3()

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()

  return {
    scene,
    camera,
    render: () => renderer.render(scene, camera),
    updateCamera: (x, z, dt) => {
      desired.set(x, 0, z)
      focus.lerp(desired, 1 - Math.exp(-12 * dt))
      camera.position.copy(focus).add(CAMERA_OFFSET)
    },
  }
}
