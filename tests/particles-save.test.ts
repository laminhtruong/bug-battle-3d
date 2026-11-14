import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuarksLoader } from 'three.quarks'
import type * as Three from 'three'

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof Three>()
  return {
    ...actual,
    WebGLRenderer: class {
      setPixelRatio() {}
      dispose() {}
    },
  }
})
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = { set: vi.fn() }
    dispose() {}
  },
}))

class ElementStub {
  innerHTML = ''
  textContent = ''
  value = ''
  classList = { toggle: vi.fn(), remove: vi.fn(), add: vi.fn() }
  listeners = new Map<string, (event: unknown) => void>()
  elements = new Map<string, ElementStub>()
  querySelector(selector: string): ElementStub {
    let element = this.elements.get(selector)
    if (!element) {
      element = new ElementStub()
      this.elements.set(selector, element)
    }
    return element
  }
  querySelectorAll() {
    return []
  }
  setAttribute() {}
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, listener)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('particle editor save lifecycle', () => {
  it('keeps edits made during a save marked as unsaved', async () => {
    vi.useFakeTimers()
    const root = new ElementStub()
    const document = Object.assign(new ElementStub(), { querySelector: () => root })
    const browser = Object.assign(new ElementStub(), {
      setTimeout,
      clearTimeout,
      requestAnimationFrame: () => 1,
    })
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', browser)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    const parse = QuarksLoader.prototype.parse
    vi.spyOn(QuarksLoader.prototype, 'parse').mockImplementation(function (
      this: QuarksLoader,
      source,
    ) {
      const json = structuredClone(source) as {
        images?: unknown[]
        textures?: unknown[]
        materials: { map?: string }[]
      }
      delete json.images
      delete json.textures
      for (const material of json.materials) delete material.map
      return parse.call(this, json)
    })
    let finishSave!: (value: unknown) => void
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return new Promise((resolve) => {
          finishSave = resolve
        })
      return { ok: true, json: async () => ({ effects: [], textures: [] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    await import('@/editor/particles-main')
    await vi.waitFor(() =>
      expect(root.querySelector('[data-inspector]').innerHTML).toContain('inspector-head'),
    )
    const click = (action: string) =>
      root.listeners.get('click')?.({
        target: { closest: () => ({ dataset: { action } }) },
      })
    click('save')
    click('duplicate-system')
    click('save')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    finishSave({ ok: true, json: async () => ({}) })
    await vi.waitFor(() =>
      expect(root.querySelector('.toast').textContent).toContain('Saved native'),
    )
    expect(root.querySelector('[data-save-state]').textContent).toBe('Unsaved changes')
  })
})
