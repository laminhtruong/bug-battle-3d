import type { Vec2 } from '@/core/math2d'

const MOVE_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])
const JOYSTICK_RADIUS = 52

export interface InputController {
  read(): Vec2
  dispose(): void
}

/**
 * Keyboard and touch stick. Screen right is world -x because the camera looks
 * down the +z axis, so both sources are mirrored here once.
 */
export function createInput(): InputController {
  const keys = new Set<string>()
  const stick = { x: 0, z: 0 }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (MOVE_KEYS.has(event.code)) {
      event.preventDefault()
    }
    keys.add(event.code)
  }
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code)
  }
  const onBlur = (): void => {
    keys.clear()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  let disposeJoystick = (): void => {}
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  if (coarsePointer) {
    const base = document.createElement('div')
    base.className = 'joystick'
    const knob = document.createElement('div')
    knob.className = 'joystick-knob'
    base.append(knob)
    document.body.append(base)

    let pointerId: number | null = null

    const move = (event: PointerEvent): void => {
      const rect = base.getBoundingClientRect()
      let dx = event.clientX - (rect.left + rect.width / 2)
      let dy = event.clientY - (rect.top + rect.height / 2)
      const length = Math.hypot(dx, dy)
      if (length > JOYSTICK_RADIUS) {
        dx = (dx / length) * JOYSTICK_RADIUS
        dy = (dy / length) * JOYSTICK_RADIUS
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`
      stick.x = -dx / JOYSTICK_RADIUS
      stick.z = -dy / JOYSTICK_RADIUS
    }
    const reset = (): void => {
      pointerId = null
      stick.x = 0
      stick.z = 0
      knob.style.transform = ''
      base.classList.remove('is-active')
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (pointerId !== null) {
        return
      }
      // Menu screens and their buttons must not spawn the stick.
      if (event.target instanceof Element && event.target.closest('.hud')) {
        return
      }
      pointerId = event.pointerId
      const half = base.offsetWidth / 2
      base.style.left = `${Math.min(Math.max(event.clientX, half), window.innerWidth - half)}px`
      base.style.top = `${Math.min(Math.max(event.clientY, half), window.innerHeight - half)}px`
      base.classList.add('is-active')
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId === pointerId) {
        move(event)
      }
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId === pointerId) {
        reset()
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('blur', reset)

    disposeJoystick = () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('blur', reset)
      base.remove()
    }
  }

  return {
    read: () => {
      let x = stick.x
      let z = stick.z
      if (keys.has('KeyA') || keys.has('ArrowLeft')) {
        x += 1
      }
      if (keys.has('KeyD') || keys.has('ArrowRight')) {
        x -= 1
      }
      if (keys.has('KeyW') || keys.has('ArrowUp')) {
        z += 1
      }
      if (keys.has('KeyS') || keys.has('ArrowDown')) {
        z -= 1
      }
      const length = Math.hypot(x, z)
      return length > 1 ? { x: x / length, z: z / length } : { x, z }
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      disposeJoystick()
    },
  }
}
