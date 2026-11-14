import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInput } from '@/ui/input'

class EditableElement {
  closest() {
    return this
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('keyboard input', () => {
  it('leaves typing and editing shortcuts alone, but handles movement outside fields', () => {
    const listeners = new Map<string, (event: unknown) => void>()
    vi.stubGlobal('Element', EditableElement)
    vi.stubGlobal('window', {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => listeners.delete(type),
      matchMedia: () => ({ matches: false }),
    })
    const input = createInput()
    const preventDefault = vi.fn()
    for (const event of [
      { code: 'KeyW', target: new EditableElement() },
      { code: 'KeyA', ctrlKey: true },
      { code: 'KeyS', metaKey: true },
      { code: 'ArrowLeft', altKey: true },
    ]) {
      listeners.get('keydown')?.({ ...event, preventDefault })
    }
    expect(preventDefault).not.toHaveBeenCalled()
    expect(input.read()).toEqual({ x: 0, z: 0 })
    listeners.get('keydown')?.({ code: 'KeyW', preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(input.read()).toEqual({ x: 0, z: 1 })
    listeners.get('keyup')?.({ code: 'KeyW' })
    expect(input.read()).toEqual({ x: 0, z: 0 })
    input.dispose()
    expect(listeners.size).toBe(0)
  })
})
