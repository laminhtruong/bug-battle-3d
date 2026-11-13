import './editor.css'
import { idPattern, PART_LIFT, PART_SCALE } from '@/content/define'
import type { Slot } from '@/content/define'
import { createPreview } from './preview'
import type { Tool } from './preview'

interface PrefabBox {
  center: [number, number, number]
  size: [number, number, number]
  hitbox?: boolean
}

interface PartDraft {
  id: string
  name: string
  model?: string
  hp: number
  score: number
  contact: { damage: number }
  boxes: PrefabBox[]
  offset?: [number, number]
  attack?: unknown
}
interface LoadedPart {
  slot: Slot
  file: string
  draft: PartDraft
  isNew?: boolean
}

const SLOTS: readonly Slot[] = ['head', 'body']

const rootElement = document.querySelector<HTMLElement>('#editor')
if (!rootElement) {
  throw new Error('missing #editor')
}
const root = rootElement

root.innerHTML = `
  <aside class="sidebar">
    <header class="brand">
      <h1>Bug editor</h1>
      <small>head and body authoring</small>
    </header>
    <section class="slot-block" data-slot="head">
      <header><h2>Heads</h2><button type="button" data-add="head">+</button></header>
      <ul data-list="head"></ul>
    </section>
    <section class="slot-block" data-slot="body">
      <header><h2>Bodies</h2><button type="button" data-add="body">+</button></header>
      <ul data-list="body"></ul>
    </section>
  </aside>
  <main class="stage">
    <canvas id="preview"></canvas>
    <div class="tools">
      <button type="button" data-tool="move" title="Move (W)" aria-label="Move (W)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>
      </button>
      <button type="button" data-tool="scale" title="Scale (R)" aria-label="Scale (R)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="10" height="10" rx="1"/><path d="M13 13l7-7M14 6h6v6"/></svg>
      </button>
      <span class="tool-sep"></span>
      <button type="button" data-action="undo" title="Undo (Ctrl+Z)" aria-label="Undo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H4v5"/><path d="M4 12a8 8 0 1 0 2.3-5.6"/></svg>
      </button>
      <button type="button" data-action="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7h5v5"/><path d="M20 12a8 8 0 1 1-2.3-5.6"/></svg>
      </button>
    </div>
    <p class="stage-hint">Drag the arrows to move the art. Enable Edit to change the colliders.</p>
  </main>
  <aside class="inspector" data-inspector></aside>
  <div class="toast" hidden></div>
`

function query<T extends Element>(selector: string): T {
  const element = root?.querySelector<T>(selector)
  if (!element) {
    throw new Error(`missing ${selector}`)
  }
  return element
}

const inspector = query<HTMLElement>('[data-inspector]')
const toast = query<HTMLElement>('.toast')
const canvas = query<HTMLCanvasElement>('#preview')

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function snap(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function fmt(value: number): string {
  return String(snap(value))
}

function toNumber(value: string, fallback = 0): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

let toastTimer: number | undefined

function flash(message: string, error = false): void {
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.hidden = true
  }, 3200)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/editor/api${path}`, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `request failed (${response.status})`)
  }
  return (await response.json()) as T
}

let parts: LoadedPart[] = []
let current: LoadedPart | undefined
const modelsBySlot: Record<Slot, string[]> = { head: [], body: [] }
let selectedBox = 0
let dirty = false
let editColliders = false
let activeTool: Tool = 'move'

interface HistoryEntry {
  undo: PartDraft[]
  redo: PartDraft[]
}

const histories = new Map<LoadedPart, HistoryEntry>()
let pendingHistory: { part: LoadedPart; snapshot: PartDraft } | undefined

function cloneDraft(draft: PartDraft): PartDraft {
  return structuredClone(draft)
}

function historyFor(part: LoadedPart): HistoryEntry {
  let history = histories.get(part)
  if (!history) {
    history = { undo: [], redo: [] }
    histories.set(part, history)
  }
  return history
}

function refreshHistoryButtons(): void {
  const history = current ? historyFor(current) : undefined
  const undo = root.querySelector<HTMLButtonElement>('[data-action="undo"]')
  const redo = root.querySelector<HTMLButtonElement>('[data-action="redo"]')
  if (undo) {
    undo.disabled = !history?.undo.length
  }
  if (redo) {
    redo.disabled = !history?.redo.length
  }
}

function pushSnapshot(part: LoadedPart, snapshot: PartDraft): void {
  const history = historyFor(part)
  history.undo.push(snapshot)
  if (history.undo.length > 100) {
    history.undo.shift()
  }
  history.redo.length = 0
  refreshHistoryButtons()
}

/** Captures the state before a drag or button that changes the part. */
function beginHistory(): void {
  if (!current) {
    return
  }
  pendingHistory = undefined
  pushSnapshot(current, cloneDraft(current.draft))
}

/** The first keystroke in a field turns the focus snapshot into one undo step. */
function commitPendingHistory(): void {
  if (!current || pendingHistory?.part !== current) {
    return
  }
  pushSnapshot(current, pendingHistory.snapshot)
  pendingHistory = undefined
}

function undo(): void {
  if (!current) {
    return
  }
  const history = historyFor(current)
  const snapshot = history.undo.pop()
  if (!snapshot) {
    return
  }
  history.redo.push(cloneDraft(current.draft))
  current.draft = snapshot
  pendingHistory = undefined
  dirty = true
  selectedBox = Math.min(selectedBox, current.draft.boxes.length - 1)
  renderInspector()
  applyPreview()
  renderList()
  refreshHistoryButtons()
}

function redo(): void {
  if (!current) {
    return
  }
  const history = historyFor(current)
  const snapshot = history.redo.pop()
  if (!snapshot) {
    return
  }
  history.undo.push(cloneDraft(current.draft))
  current.draft = snapshot
  pendingHistory = undefined
  dirty = true
  selectedBox = Math.min(selectedBox, current.draft.boxes.length - 1)
  renderInspector()
  applyPreview()
  renderList()
  refreshHistoryButtons()
}

function setTool(tool: Tool): void {
  activeTool = tool
  preview.setTool(tool)
  for (const button of root.querySelectorAll<HTMLElement>('[data-tool]')) {
    button.classList.toggle('active', button.dataset.tool === tool)
  }
}

function markDirty(): void {
  dirty = true
  const button = inspector.querySelector<HTMLButtonElement>('[data-action="save"]')
  if (button) {
    button.disabled = false
  }
}

function setDirty(value: boolean): void {
  dirty = value
  const button = inspector.querySelector<HTMLButtonElement>('[data-action="save"]')
  if (button) {
    button.disabled = !value
  }
}

function currentArenaBoxes(): {
  x: number
  y: number
  z: number
  halfWidth: number
  halfHeight: number
  halfDepth: number
  hitbox: boolean
}[] {
  if (!current) {
    return []
  }
  return current.draft.boxes.map((box) => ({
    x: box.center[0] * PART_SCALE,
    // The prefab lifts the art and its colliders above the pivot.
    y: box.center[1] * PART_SCALE + PART_LIFT,
    z: box.center[2] * PART_SCALE,
    halfWidth: (box.size[0] * PART_SCALE) / 2,
    halfHeight: (box.size[1] * PART_SCALE) / 2,
    halfDepth: (box.size[2] * PART_SCALE) / 2,
    hitbox: box.hitbox === true,
  }))
}

function syncOffsetInputs(): void {
  const offset = current?.draft.offset ?? [0, 0]
  const x = inspector.querySelector<HTMLInputElement>('[data-field="offset-x"]')
  const z = inspector.querySelector<HTMLInputElement>('[data-field="offset-z"]')
  if (x) {
    x.value = fmt(offset[0])
  }
  if (z) {
    z.value = fmt(offset[1])
  }
}

function syncBoxInputs(index: number): void {
  const box = current?.draft.boxes[index]
  if (!box) {
    return
  }
  const row = inspector.querySelector<HTMLElement>(`.box-row[data-box-index="${index}"]`)
  if (!row) {
    return
  }
  const set = (field: string, value: number): void => {
    const input = row.querySelector<HTMLInputElement>(`[data-box-field="${field}"]`)
    if (input) {
      input.value = fmt(value)
    }
  }
  set('center-x', box.center[0])
  set('center-y', box.center[1])
  set('center-z', box.center[2])
  set('size-x', box.size[0])
  set('size-y', box.size[1])
  set('size-z', box.size[2])
}

const preview = createPreview(canvas, {
  onSelect(index) {
    selectBox(index)
  },
  onDragStart() {
    beginHistory()
  },
  onMove(index, x, y, z) {
    const box = current?.draft.boxes[index]
    if (!box) {
      return
    }
    box.center = [snap(x / PART_SCALE), snap((y - PART_LIFT) / PART_SCALE), snap(z / PART_SCALE)]
    syncBoxInputs(index)
    markDirty()
  },
  onOffset(x, z) {
    if (!current) {
      return
    }
    current.draft.offset = [snap(x), snap(z)]
    syncOffsetInputs()
    markDirty()
  },
  onScale(index, halfWidth, halfHeight, halfDepth) {
    const box = current?.draft.boxes[index]
    if (!box) {
      return
    }
    box.size = [
      snap((halfWidth * 2) / PART_SCALE),
      snap((halfHeight * 2) / PART_SCALE),
      snap((halfDepth * 2) / PART_SCALE),
    ]
    syncBoxInputs(index)
    markDirty()
  },
  onDragEnd() {
    applyPreview()
  },
})

function applyPreview(): void {
  if (!current) {
    preview.clear()
    return
  }
  preview.show({
    slot: current.slot,
    model: current.draft.model || current.draft.id,
    offset: current.draft.offset ?? [0, 0],
    boxes: currentArenaBoxes(),
    selected: selectedBox,
    showReference: true,
    editColliders,
  })
}

function renderList(): void {
  for (const slot of SLOTS) {
    const list = query<HTMLUListElement>(`[data-list="${slot}"]`)
    list.innerHTML = parts
      .filter((part) => part.slot === slot)
      .map((part) => {
        const selected = part === current
        return `<li>
          <button type="button" class="part-item${selected ? ' selected' : ''}" data-part="${slot}:${part.draft.id}">
            <span>${escapeHtml(part.draft.name || part.draft.id)}</span>
            <small>${escapeHtml(part.draft.id)}${part.isNew ? ' (new)' : ''}</small>
          </button>
        </li>`
      })
      .join('')
  }
}

function attackSummary(attack: unknown): string {
  if (!attack || typeof attack !== 'object') {
    return 'No attack. Anything set here is preserved when you save.'
  }
  const kind = (attack as { kind?: unknown }).kind
  if (kind === 'projectile' || kind === 'cone') {
    return `${kind} attack. The editor keeps it unchanged.`
  }
  return 'Custom attack. The editor keeps it unchanged.'
}

function boxRows(): string {
  if (!current) {
    return ''
  }
  const boxes = current.draft.boxes
  return boxes
    .map(
      (
        box,
        index,
      ) => `<div class="box-row${index === selectedBox ? ' selected' : ''}" data-box-index="${index}">
        <button type="button" class="box-index" data-action="select-box" data-index="${index}">${index + 1}</button>
        <label>CX<input data-box-field="center-x" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[0])}"></label>
        <label>CY<input data-box-field="center-y" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[1])}"></label>
        <label>CZ<input data-box-field="center-z" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[2])}"></label>
        <label>SX<input data-box-field="size-x" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[0])}"></label>
        <label>SY<input data-box-field="size-y" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[1])}"></label>
        <label>SZ<input data-box-field="size-z" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[2])}"></label>
        <label class="check"><input data-box-field="hitbox" data-box-index="${index}" type="checkbox" ${box.hitbox ? 'checked' : ''}>claw</label>
        <button type="button" class="icon danger" data-action="delete-box" data-index="${index}" ${boxes.length <= 1 ? 'disabled' : ''}>x</button>
      </div>`,
    )
    .join('')
}

function renderInspector(): void {
  if (!current) {
    inspector.innerHTML = '<p class="empty">Select a part on the left, or add one.</p>'
    return
  }
  const draft = current.draft
  const offset = draft.offset ?? [0, 0]
  const modelOptions = modelsBySlot[current.slot]
  inspector.innerHTML = `
    <header class="inspector-head">
      <span class="badge">${current.slot}</span>
      <strong>${escapeHtml(draft.name || draft.id)}</strong>
      ${current.isNew ? '<span class="badge new">unsaved</span>' : ''}
    </header>
    <section class="group">
      <h3>Part</h3>
      <label>Id<input data-field="id" value="${escapeHtml(draft.id)}" ${current.isNew ? '' : 'disabled'}></label>
      <label>Name<input data-field="name" value="${escapeHtml(draft.name)}"></label>
      <label>Model<input data-field="model" list="model-options" value="${escapeHtml(draft.model || '')}" placeholder="${escapeHtml(draft.id)}"></label>
      <datalist id="model-options">${modelOptions.map((model) => `<option value="${escapeHtml(model)}"></option>`).join('')}</datalist>
      <div class="row">
        <label>HP<input data-field="hp" type="number" min="1" step="1" value="${draft.hp}"></label>
        <label>Score<input data-field="score" type="number" min="0" step="1" value="${draft.score}"></label>
        <label>Contact<input data-field="damage" type="number" min="0" step="1" value="${draft.contact.damage}"></label>
      </div>
    </section>
    <section class="group">
      <h3>${current.slot === 'head' ? 'Head position' : 'Body position'}</h3>
      <p class="hint">X and Z move the art only, in prefab units. Y is fixed by the prefab lift.</p>
      <div class="row">
        <label>X<input data-field="offset-x" type="number" step="0.05" value="${fmt(offset[0])}"></label>
        <label>Y<input type="number" value="0" disabled title="Fixed by the prefab lift"></label>
        <label>Z<input data-field="offset-z" type="number" step="0.05" value="${fmt(offset[1])}"></label>
      </div>
    </section>
    <section class="group">
      <div class="group-head">
        <h3>Colliders</h3>
        <div class="group-tools">
          <label class="check"><input data-field="collider-edit" type="checkbox" ${editColliders ? 'checked' : ''}>Edit</label>
          ${editColliders ? '<button type="button" data-action="add-box">+ box</button>' : ''}
        </div>
      </div>
      ${
        editColliders
          ? `<p class="hint">C is the centre, S is the size, like the Unity BoxCollider. Green is a hurtbox, red is a hitbox.</p>
             <div class="boxes">${boxRows()}</div>`
          : '<p class="hint">Hidden. Drag the arrows to move the art, or tick Edit to change the boxes.</p>'
      }
    </section>
    <section class="group">
      <h3>Attack</h3>
      <p class="hint">${attackSummary(draft.attack)}</p>
    </section>
    <div class="actions">
      <button type="button" class="primary" data-action="save">Save</button>
      <button type="button" class="danger" data-action="delete">Delete</button>
    </div>
  `
  setDirty(dirty)
  refreshHistoryButtons()
}

function setEditColliders(value: boolean): void {
  editColliders = value
  if (!value) {
    setTool('move')
  }
  const scale = root.querySelector<HTMLButtonElement>('[data-tool="scale"]')
  if (scale) {
    scale.disabled = !value
  }
  renderInspector()
  applyPreview()
}

function selectBox(index: number): void {
  if (!current || !Number.isInteger(index)) {
    return
  }
  selectedBox = Math.max(0, Math.min(index, current.draft.boxes.length - 1))
  for (const row of inspector.querySelectorAll<HTMLElement>('.box-row')) {
    row.classList.toggle('selected', Number(row.dataset.boxIndex) === selectedBox)
  }
  preview.select(selectedBox)
}

function selectPart(slot: Slot, id: string): void {
  const target = parts.find((part) => part.slot === slot && part.draft.id === id)
  if (!target || target === current) {
    return
  }
  if (dirty && !window.confirm('Discard unsaved changes?')) {
    return
  }
  current = target
  selectedBox = 0
  dirty = false
  pendingHistory = undefined
  renderList()
  renderInspector()
  applyPreview()
}

function setField(target: HTMLInputElement): void {
  if (!current) {
    return
  }
  if (target.dataset.field === 'collider-edit') {
    setEditColliders(target.checked)
    return
  }
  commitPendingHistory()
  const draft = current.draft
  switch (target.dataset.field) {
    case 'id':
      draft.id = target.value
      break
    case 'name':
      draft.name = target.value
      break
    case 'model':
      draft.model = target.value.trim() || undefined
      applyPreview()
      break
    case 'hp':
      draft.hp = toNumber(target.value)
      break
    case 'score':
      draft.score = toNumber(target.value)
      break
    case 'damage':
      draft.contact.damage = toNumber(target.value)
      break
    case 'offset-x':
      draft.offset = [toNumber(target.value), draft.offset?.[1] ?? 0]
      applyPreview()
      break
    case 'offset-z':
      draft.offset = [draft.offset?.[0] ?? 0, toNumber(target.value)]
      applyPreview()
      break
    default:
      return
  }
  markDirty()
}

function setBoxField(target: HTMLInputElement): void {
  const index = Number(target.dataset.boxIndex)
  const box = current?.draft.boxes[index]
  if (!box) {
    return
  }
  commitPendingHistory()
  switch (target.dataset.boxField) {
    case 'center-x':
      box.center = [toNumber(target.value), box.center[1], box.center[2]]
      break
    case 'center-y':
      box.center = [box.center[0], toNumber(target.value), box.center[2]]
      break
    case 'center-z':
      box.center = [box.center[0], box.center[1], toNumber(target.value)]
      break
    case 'size-x':
      box.size = [toNumber(target.value), box.size[1], box.size[2]]
      break
    case 'size-y':
      box.size = [box.size[0], toNumber(target.value), box.size[2]]
      break
    case 'size-z':
      box.size = [box.size[0], box.size[1], toNumber(target.value)]
      break
    case 'hitbox':
      box.hitbox = target.checked
      break
    default:
      return
  }
  selectedBox = index
  applyPreview()
  markDirty()
}

function validate(draft: PartDraft): string | undefined {
  if (!idPattern.test(draft.id)) {
    return 'Id must be kebab-case, for example my-head.'
  }
  if (!draft.name.trim()) {
    return 'Name is required.'
  }
  if (draft.model && !idPattern.test(draft.model)) {
    return 'Model must be kebab-case.'
  }
  if (!Number.isInteger(draft.hp) || draft.hp < 1) {
    return 'HP must be a positive integer.'
  }
  if (!Number.isInteger(draft.score) || draft.score < 0) {
    return 'Score must be a whole number, zero or more.'
  }
  if (!Number.isInteger(draft.contact.damage) || draft.contact.damage < 0) {
    return 'Contact damage must be a whole number, zero or more.'
  }
  if (draft.boxes.length === 0) {
    return 'A part needs at least one collider box.'
  }
  if (draft.boxes.some((box) => !(box.size[0] > 0) || !(box.size[1] > 0) || !(box.size[2] > 0))) {
    return 'Every box needs a positive size.'
  }
  if (draft.contact.damage > 0 && !draft.boxes.some((box) => box.hitbox)) {
    return 'Contact damage needs at least one claw box.'
  }
  return undefined
}

async function save(): Promise<void> {
  if (!current) {
    return
  }
  const error = validate(current.draft)
  if (error) {
    flash(error, true)
    return
  }
  try {
    const data = await request<{ part: LoadedPart }>('/parts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slot: current.slot, draft: current.draft }),
    })
    current.isNew = false
    current.file = data.part.file
    current.draft = data.part.draft
    pendingHistory = undefined
    setDirty(false)
    renderList()
    renderInspector()
    applyPreview()
    flash(`Saved ${current.slot} "${current.draft.id}".`)
  } catch (errorValue) {
    flash(errorValue instanceof Error ? errorValue.message : 'Save failed.', true)
  }
}

function addBox(): void {
  if (!current) {
    return
  }
  beginHistory()
  current.draft.boxes.push({ center: [0, 0.4, 0], size: [1, 2.4, 1] })
  selectedBox = current.draft.boxes.length - 1
  renderInspector()
  applyPreview()
  markDirty()
}

function deleteBox(index: number): void {
  if (!current || current.draft.boxes.length <= 1) {
    return
  }
  beginHistory()
  current.draft.boxes.splice(index, 1)
  if (selectedBox > index) {
    selectedBox -= 1
  }
  selectedBox = Math.min(selectedBox, current.draft.boxes.length - 1)
  renderInspector()
  applyPreview()
  markDirty()
}

function addPart(slot: Slot): void {
  const id = window.prompt(`New ${slot} id (kebab-case)`)?.trim()
  if (!id) {
    return
  }
  if (!idPattern.test(id)) {
    flash('Use kebab-case, for example my-head.', true)
    return
  }
  if (parts.some((part) => part.slot === slot && part.draft.id === id)) {
    flash(`The ${slot} id "${id}" already exists.`, true)
    return
  }
  if (dirty && !window.confirm('Discard unsaved changes?')) {
    return
  }
  const draft: PartDraft = {
    id,
    name: id,
    hp: 2,
    score: 10,
    contact: { damage: 0 },
    boxes: [{ center: [0, 0.4, 0], size: [2, 2.4, 1.4] }],
  }
  const part: LoadedPart = { slot, file: `${id}.ts`, draft, isNew: true }
  parts.push(part)
  current = part
  selectedBox = 0
  dirty = true
  pendingHistory = undefined
  renderList()
  renderInspector()
  applyPreview()
}

async function removePart(): Promise<void> {
  if (!current) {
    return
  }
  const removed = current
  if (!removed.isNew && !window.confirm(`Delete ${removed.slot} "${removed.draft.id}"?`)) {
    return
  }
  try {
    if (!removed.isNew) {
      await request(
        `/parts?slot=${encodeURIComponent(removed.slot)}&id=${encodeURIComponent(removed.draft.id)}`,
        { method: 'DELETE' },
      )
    }
    parts = parts.filter((part) => part !== removed)
    histories.delete(removed)
    current = parts[0]
    selectedBox = 0
    dirty = false
    pendingHistory = undefined
    renderList()
    renderInspector()
    applyPreview()
    flash(`Deleted ${removed.draft.id}.`)
  } catch (errorValue) {
    flash(errorValue instanceof Error ? errorValue.message : 'Delete failed.', true)
  }
}

root.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const add = target.closest<HTMLElement>('[data-add]')
  if (add) {
    addPart(add.dataset.add as Slot)
    return
  }
  const tool = target.closest<HTMLElement>('[data-tool]')
  if (tool?.dataset.tool) {
    setTool(tool.dataset.tool as Tool)
    return
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'undo') {
    undo()
    return
  }
  if (action === 'redo') {
    redo()
    return
  }
  const partButton = target.closest<HTMLElement>('[data-part]')
  if (partButton?.dataset.part) {
    const [slot, id] = partButton.dataset.part.split(':')
    if (slot === 'head' || slot === 'body') {
      selectPart(slot, id ?? '')
    }
  }
})

inspector.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  if (action === 'save') {
    void save()
    return
  }
  if (action === 'delete') {
    void removePart()
    return
  }
  if (action === 'add-box') {
    addBox()
    return
  }
  if (action === 'delete-box') {
    const index = Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)
    if (Number.isInteger(index)) {
      deleteBox(index)
    }
    return
  }
  if (action === 'select-box') {
    const index = Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)
    if (Number.isInteger(index)) {
      selectBox(index)
    }
    return
  }
  const row = target.closest<HTMLElement>('[data-box-index]')
  if (row) {
    const index = Number(row.dataset.boxIndex)
    if (Number.isInteger(index)) {
      selectBox(index)
    }
  }
})

inspector.addEventListener('focusin', (event) => {
  const target = event.target as HTMLElement
  if (!current || target.dataset.field === 'collider-edit') {
    return
  }
  if (target.closest('[data-field], [data-box-field]')) {
    pendingHistory = { part: current, snapshot: cloneDraft(current.draft) }
  }
})

inspector.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.dataset.field) {
    setField(target)
  } else if (target.dataset.boxField) {
    setBoxField(target)
  }
})

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement
  const typing =
    target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
  const command = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (command && key === 's') {
    event.preventDefault()
    void save()
    return
  }
  if (command && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) {
      redo()
    } else {
      undo()
    }
    return
  }
  if (command && key === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if (typing || command || event.altKey) {
    return
  }
  if (key === 'w') {
    setTool('move')
  } else if (key === 'r' && editColliders) {
    setTool('scale')
  }
})

window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault()
    event.returnValue = ''
  }
})

async function loadModels(): Promise<void> {
  for (const slot of SLOTS) {
    try {
      const data = await request<{ models: string[] }>(`/models?slot=${slot}`)
      modelsBySlot[slot] = data.models
    } catch {
      modelsBySlot[slot] = []
    }
  }
}

async function bootstrap(): Promise<void> {
  const data = await request<{ parts: LoadedPart[] }>('/parts')
  parts = data.parts
  await loadModels()
  current = parts[0]
  selectedBox = 0
  renderList()
  renderInspector()
  setTool(activeTool)
  const scaleButton = root.querySelector<HTMLButtonElement>('[data-tool="scale"]')
  if (scaleButton) {
    scaleButton.disabled = !editColliders
  }
  applyPreview()
}

void bootstrap().catch((errorValue: unknown) => {
  inspector.innerHTML = `<p class="empty">${escapeHtml(
    errorValue instanceof Error ? errorValue.message : 'Could not load parts.',
  )}</p>`
  flash('Run this page through the dev server: npm run editor.', true)
})
