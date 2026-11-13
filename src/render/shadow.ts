import * as THREE from 'three'

/**
 * A soft blob shadow under each segment. A cheap radial sprite reads the same
 * as real shadow maps at this camera distance.
 */
let shadowTexture: THREE.Texture | undefined

function texture(): THREE.Texture {
  if (shadowTexture) {
    return shadowTexture
  }
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.42)')
    gradient.addColorStop(0.65, 'rgba(0, 0, 0, 0.22)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  }
  shadowTexture = new THREE.CanvasTexture(canvas)
  return shadowTexture
}

const geometry = new THREE.PlaneGeometry(1, 1)
geometry.rotateX(-Math.PI / 2)
const material = new THREE.MeshBasicMaterial({
  map: texture(),
  transparent: true,
  depthWrite: false,
})

export function createShadow(size: number): THREE.Mesh {
  const shadow = new THREE.Mesh(geometry, material)
  shadow.scale.setScalar(size)
  shadow.position.y = 0.02
  shadow.renderOrder = 1
  return shadow
}
