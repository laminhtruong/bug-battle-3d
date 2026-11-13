import * as THREE from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const WIDTH = 120
const HEIGHT = 128
const CENTER_X = WIDTH / 2
const CENTER_Y = 56
const RADIUS = 34

interface AxisEntry {
  axis: THREE.Vector3
  color: string
  label: string
  positive: boolean
}

interface AxisPoint extends AxisEntry {
  x: number
  y: number
  /** Positive when the axis points toward the camera. */
  depth: number
}

const AXES: AxisEntry[] = [
  { axis: new THREE.Vector3(1, 0, 0), color: '#e05d5d', label: 'x', positive: true },
  { axis: new THREE.Vector3(-1, 0, 0), color: '#e05d5d', label: '', positive: false },
  { axis: new THREE.Vector3(0, 1, 0), color: '#63c76a', label: 'y', positive: true },
  { axis: new THREE.Vector3(0, -1, 0), color: '#63c76a', label: '', positive: false },
  { axis: new THREE.Vector3(0, 0, 1), color: '#5b8dd6', label: 'z', positive: true },
  { axis: new THREE.Vector3(0, 0, -1), color: '#5b8dd6', label: '', positive: false },
]

export interface ViewGizmo {
  update(): void
  dispose(): void
}

/** The axis widget: click an axis to snap, drag it to orbit. */
export function createViewGizmo(
  container: HTMLElement,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): ViewGizmo {
  const canvas = document.createElement('canvas')
  canvas.className = 'view-gizmo'
  canvas.title = 'Click an axis to snap, drag to orbit'
  const ratio = Math.min(window.devicePixelRatio, 2)
  canvas.width = WIDTH * ratio
  canvas.height = HEIGHT * ratio
  canvas.style.width = `${WIDTH}px`
  canvas.style.height = `${HEIGHT}px`
  container.append(canvas)

  const context2d = canvas.getContext('2d')
  if (!context2d) {
    throw new Error('missing 2d context for the orientation gizmo')
  }
  const context = context2d

  const inverse = new THREE.Quaternion()
  const view = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const spherical = new THREE.Spherical()
  const points: AxisPoint[] = []
  let drag: { id: number; lastX: number; lastY: number; moved: number } | null = null

  function project(): void {
    inverse.copy(camera.quaternion).invert()
    points.length = 0
    for (const entry of AXES) {
      view.copy(entry.axis).applyQuaternion(inverse)
      points.push({
        ...entry,
        x: CENTER_X + view.x * RADIUS,
        y: CENTER_Y - view.y * RADIUS,
        depth: view.z,
      })
    }
  }

  function viewName(): string {
    offset.copy(camera.position).sub(controls.target)
    if (offset.lengthSq() < 1e-8) {
      return 'Front'
    }
    if (Math.abs(offset.y) >= Math.max(Math.abs(offset.x), Math.abs(offset.z))) {
      return offset.y >= 0 ? 'Top' : 'Bottom'
    }
    if (Math.abs(offset.x) >= Math.abs(offset.z)) {
      return offset.x >= 0 ? 'Right' : 'Left'
    }
    return offset.z >= 0 ? 'Front' : 'Back'
  }

  function draw(): void {
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, WIDTH, HEIGHT)
    context.lineCap = 'round'

    const ordered = [...points].sort((first, second) => first.depth - second.depth)
    for (const point of ordered) {
      const dx = point.x - CENTER_X
      const dy = point.y - CENTER_Y
      const length = Math.hypot(dx, dy)
      const alpha = point.depth > 0 ? 1 : 0.55
      context.globalAlpha = alpha
      context.strokeStyle = point.color
      context.fillStyle = point.color
      context.lineWidth = point.positive ? 2.2 : 1.2
      if (length > 1) {
        const stop = point.positive ? Math.max(0, length - 9) : length
        context.beginPath()
        context.moveTo(CENTER_X, CENTER_Y)
        context.lineTo(CENTER_X + (dx / length) * stop, CENTER_Y + (dy / length) * stop)
        context.stroke()
      }

      if (!point.positive) {
        context.beginPath()
        context.arc(point.x, point.y, 2.4, 0, Math.PI * 2)
        context.fill()
      } else if (length < 6) {
        // Pointing at the camera: show the cone head-on.
        context.beginPath()
        context.arc(point.x, point.y, 4.5, 0, Math.PI * 2)
        context.fill()
      } else {
        const ux = dx / length
        const uy = dy / length
        const baseX = point.x - ux * 9
        const baseY = point.y - uy * 9
        context.beginPath()
        context.moveTo(point.x, point.y)
        context.lineTo(baseX - uy * 4, baseY + ux * 4)
        context.lineTo(baseX + uy * 4, baseY - ux * 4)
        context.closePath()
        context.fill()
      }
    }

    context.globalAlpha = 1
    context.beginPath()
    context.roundRect(CENTER_X - 7, CENTER_Y - 7, 14, 14, 3)
    context.fillStyle = '#e8edf1'
    context.fill()
    context.strokeStyle = '#2a333a'
    context.lineWidth = 1
    context.stroke()

    context.font = '700 11px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#eef4f8'
    for (const point of points) {
      if (!point.positive || !point.label) {
        continue
      }
      const dx = point.x - CENTER_X
      const dy = point.y - CENTER_Y
      const length = Math.hypot(dx, dy)
      const scale = length < 1 ? 0 : 12 / length
      context.fillText(point.label, point.x + dx * scale, point.y + dy * scale)
    }

    context.strokeStyle = '#9fb0bc'
    context.lineWidth = 1.5
    context.beginPath()
    context.moveTo(CENTER_X - 40, HEIGHT - 15)
    context.lineTo(CENTER_X - 34, HEIGHT - 19)
    context.lineTo(CENTER_X - 34, HEIGHT - 11)
    context.stroke()

    context.font = '500 12px system-ui, sans-serif'
    context.fillStyle = '#a9b8c3'
    context.textAlign = 'left'
    context.fillText(viewName(), CENTER_X - 30, HEIGHT - 15)
  }

  function orbit(dx: number, dy: number): void {
    offset.copy(camera.position).sub(controls.target)
    spherical.setFromVector3(offset)
    spherical.theta -= dx * 0.012
    spherical.phi = Math.min(Math.PI - 0.02, Math.max(0.02, spherical.phi - dy * 0.012))
    offset.setFromSpherical(spherical)
    camera.position.copy(controls.target).add(offset)
    controls.update()
  }

  function snap(axis: THREE.Vector3): void {
    const distance = Math.max(1.2, camera.position.distanceTo(controls.target))
    offset.copy(axis)
    // Avoid a camera exactly parallel to its up vector on the top view.
    if (Math.abs(offset.y) > 0.9) {
      offset.z += 0.001
    }
    offset.normalize()
    camera.position.copy(controls.target).addScaledVector(offset, distance)
    controls.update()
  }

  function localPoint(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
    }
  }

  function nearestAxis(x: number, y: number): AxisPoint | undefined {
    let best: AxisPoint | undefined
    let bestDistance = 14
    for (const point of points) {
      const distance = Math.hypot(point.x - x, point.y - y)
      if (distance < bestDistance) {
        best = point
        bestDistance = distance
      }
    }
    return best
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return
    }
    const point = localPoint(event)
    drag = { id: event.pointerId, lastX: point.x, lastY: point.y, moved: 0 }
    canvas.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    const point = localPoint(event)
    const dx = point.x - drag.lastX
    const dy = point.y - drag.lastY
    drag.lastX = point.x
    drag.lastY = point.y
    drag.moved += Math.abs(dx) + Math.abs(dy)
    orbit(dx, dy)
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag || drag.id !== event.pointerId) {
      return
    }
    const wasClick = drag.moved < 4
    drag = null
    if (!wasClick) {
      return
    }
    const point = localPoint(event)
    project()
    const axis = nearestAxis(point.x, point.y)
    if (axis) {
      snap(axis.axis)
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  return {
    update() {
      project()
      draw()
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.remove()
    },
  }
}
