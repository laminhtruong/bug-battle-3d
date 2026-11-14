import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const preview = vi.hoisted(() => ({
  show: vi.fn(),
  clear: vi.fn(),
  setTool: vi.fn(),
  select: vi.fn(),
  selectSpawn: vi.fn(),
}))
vi.mock('@/editor/preview', () => ({ createPreview: () => preview }))

class ElementStub {
  innerHTML = ''
  textContent = ''
  dataset: Record<string, string> = {}
  classList = { toggle: vi.fn(), remove: vi.fn() }
  listeners = new Map<string, (event: unknown) => void>()
  children = new Map<string, ElementStub>()
  querySelector(selector: string): ElementStub {
    let element = this.children.get(selector)
    if (!element) {
      element = new ElementStub()
      this.children.set(selector, element)
    }
    return element
  }
  querySelectorAll() {
    return []
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, listener)
  }
}

let root: ElementStub
let browser: ElementStub
let finishSave: (value: unknown) => void
let fetchMock: ReturnType<typeof vi.fn>
const parts = ['first', 'second'].map((id) => ({
  slot: 'head',
  file: `${id}.json`,
  draft: {
    id,
    name: id,
    hp: 2,
    score: 10,
    contact: { damage: 0 },
    boxes: [{ center: [0, 0, 0], size: [1, 1, 1] }],
  },
}))

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  root = new ElementStub()
  browser = Object.assign(new ElementStub(), {
    setTimeout,
    clearTimeout,
    confirm: () => true,
  })
  vi.stubGlobal('document', { querySelector: () => root })
  vi.stubGlobal('window', browser)
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Promise((resolve) => {
        finishSave = resolve
      })
    }
    return {
      ok: true,
      json: async () => ({ parts: structuredClone(parts), models: [], effects: [] }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  await import('@/editor/main')
  await vi.waitFor(() => expect(preview.show).toHaveBeenCalled())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function click(element: ElementStub, attribute: string, value: string) {
  element.listeners.get('click')?.({
    target: {
      closest: (selector: string) =>
        selector === `[data-${attribute}]` ? { dataset: { [attribute]: value } } : null,
    },
  })
}

async function completeSave() {
  finishSave({ ok: true, json: async () => ({ part: structuredClone(parts[0]) }) })
  await vi.waitFor(() => expect(root.querySelector('.toast').textContent).toContain('Saved'))
}

describe('part editor save lifecycle', () => {
  it('does not replace the selected part when an earlier save finishes', async () => {
    const inspector = root.querySelector('[data-inspector]')
    click(inspector, 'action', 'save')
    click(root, 'part', 'head:second')
    await completeSave()
    expect(preview.show).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'second' }))
    expect(inspector.innerHTML).toContain('second')
  })

  it('keeps edits made during a save dirty and prevents overlapping saves', async () => {
    const inspector = root.querySelector('[data-inspector]')
    click(inspector, 'action', 'save')
    click(inspector, 'action', 'add-box')
    click(inspector, 'action', 'save')
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    await completeSave()
    expect(preview.show).toHaveBeenLastCalledWith(
      expect.objectContaining({ boxes: expect.any(Array) }),
    )
    expect(preview.show.mock.lastCall?.[0].boxes).toHaveLength(2)
    const preventDefault = vi.fn()
    browser.listeners.get('beforeunload')?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
  })
})
