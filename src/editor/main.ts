import './editor.css'
import {
  DEFAULT_SPAWN_Y,
  idPattern,
  PART_LIFT,
  rotateBoxPoint,
  unrotateBoxPoint,
} from '@/content/define'
import type { AttackDef, Slot, SpawnPoint } from '@/content/define'
import { ATTACK_PRESETS, ATTACK_VISUALS, attackPreset } from './attacks'
import { createPreview } from './preview'
import type { Tool } from './preview'

interface BoxDraft {
  center: [number, number, number]
  size: [number, number, number]
  rotation?: [number, number, number]
  hitbox?: boolean
}

interface PartDraft {
  id: string
  name: string
  model?: string
  hp: number
  score: number
  contact: { damage: number }
  boxes: BoxDraft[]
  offset?: [number, number]
  attack?: AttackDef
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
/** -1 selects the part itself, so only one object shows its arrows. */
let selectedSpawn = -1
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
  clampSelectedSpawn()
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
  clampSelectedSpawn()
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

/** Both attack kinds can carry muzzles; the UI and the view treat them the same. */
function attackSpawns(attack: AttackDef): SpawnPoint[] {
  return attack.kind === 'cone' ? attack.cone.spawnPoints : attack.projectile.spawnPoints
}

function clampSelectedSpawn(): void {
  const attack = current?.draft.attack
  if (!attack) {
    selectedSpawn = -1
    return
  }
  if (selectedSpawn < 0) {
    return
  }
  selectedSpawn = Math.min(selectedSpawn, attackSpawns(attack).length - 1)
}

function currentArenaBoxes(): {
  x: number
  y: number
  z: number
  halfWidth: number
  halfHeight: number
  halfDepth: number
  rotation: [number, number, number]
  hitbox: boolean
}[] {
  if (!current) {
    return []
  }
  return current.draft.boxes.map((box) => {
    const rotation: [number, number, number] = box.rotation ?? [0, 0, 0]
    // The box rotates around the part pivot, so its centre turns too.
    const center = rotateBoxPoint(rotation, box.center)
    return {
      x: center[0],
      // The art and its colliders sit above the pivot by the part lift.
      y: center[1] + PART_LIFT,
      z: center[2],
      halfWidth: box.size[0] / 2,
      halfHeight: box.size[1] / 2,
      halfDepth: box.size[2] / 2,
      rotation,
      hitbox: box.hitbox === true,
    }
  })
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
  const rotation = box.rotation ?? [0, 0, 0]
  set('rotation-x', rotation[0])
  set('rotation-y', rotation[1])
  set('rotation-z', rotation[2])
}

function syncSpawnInputs(index: number): void {
  const attack = current?.draft.attack
  if (!attack) {
    return
  }
  const point = attackSpawns(attack)[index]
  const row = inspector.querySelector<HTMLElement>(`.spawn-row[data-spawn-index="${index}"]`)
  if (!point || !row) {
    return
  }
  const set = (field: string, value: number): void => {
    const input = row.querySelector<HTMLInputElement>(`[data-spawn-field="${field}"]`)
    if (input) {
      input.value = fmt(value)
    }
  }
  set('x', point.x)
  set('y', point.y)
  set('z', point.z)
  set('angle', point.angle)
}

const preview = createPreview(canvas, {
  onSelect(index) {
    selectBox(index)
  },
  onSelectSpawn(index) {
    selectSpawn(index)
  },
  onSelectPart() {
    selectPartTarget()
  },
  onDragStart() {
    beginHistory()
  },
  onMove(index, x, y, z) {
    const box = current?.draft.boxes[index]
    if (!box) {
      return
    }
    // The gizmo works in world space; the draft stores the unrotated centre.
    const center = unrotateBoxPoint(box.rotation ?? [0, 0, 0], [x, y - PART_LIFT, z])
    box.center = [snap(center[0]), snap(center[1]), snap(center[2])]
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
  onSpawnMove(index, x, y, z) {
    const attack = current?.draft.attack
    if (!attack) {
      return
    }
    const point = attackSpawns(attack)[index]
    if (!point) {
      return
    }
    point.x = snap(x)
    point.y = snap(y)
    point.z = snap(z)
    syncSpawnInputs(index)
    markDirty()
  },
  onSpawnRotate(index, degrees) {
    const attack = current?.draft.attack
    if (!attack) {
      return
    }
    const point = attackSpawns(attack)[index]
    if (!point) {
      return
    }
    point.angle = snap(degrees)
    syncSpawnInputs(index)
    markDirty()
  },
  onScale(index, halfWidth, halfHeight, halfDepth) {
    const box = current?.draft.boxes[index]
    if (!box) {
      return
    }
    box.size = [snap(halfWidth * 2), snap(halfHeight * 2), snap(halfDepth * 2)]
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
  const attack = current.draft.attack
  preview.show({
    slot: current.slot,
    model: current.draft.model || current.draft.id,
    offset: current.draft.offset ?? [0, 0],
    boxes: currentArenaBoxes(),
    selected: selectedBox,
    spawns: attack ? attackSpawns(attack).map((point) => ({ ...point })) : [],
    selectedSpawn,
    cone:
      attack?.kind === 'cone'
        ? { range: attack.cone.range, halfAngleDeg: attack.cone.halfAngleDeg }
        : undefined,
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

function visualOptions(current: string): string {
  const known = ATTACK_VISUALS as readonly string[]
  const visuals = known.includes(current) ? known : [...known, current]
  return visuals
    .map(
      (visual) =>
        `<option value="${escapeHtml(visual)}" ${visual === current ? 'selected' : ''}>${escapeHtml(visual)}</option>`,
    )
    .join('')
}

function attackPresetSelect(attack: AttackDef | undefined): string {
  const preset = attackPreset(attack)
  const known = ATTACK_PRESETS.some((candidate) => candidate.id === preset)
  return `<label>Preset
    <select data-field="attack-preset">
      <option value="" ${preset === '' ? 'selected' : ''}>No attack</option>
      ${ATTACK_PRESETS.map(
        (candidate) =>
          `<option value="${candidate.id}" ${candidate.id === preset ? 'selected' : ''}>${candidate.label}</option>`,
      ).join('')}
      ${preset && !known ? '<option value="custom" selected>Custom</option>' : ''}
    </select>
  </label>`
}

function spawnRows(points: SpawnPoint[]): string {
  return points
    .map(
      (
        point,
        index,
      ) => `<div class="spawn-row${index === selectedSpawn ? ' selected' : ''}" data-spawn-index="${index}">
        <button type="button" class="box-index" data-action="select-spawn" data-index="${index}">${index + 1}</button>
        <label>X<input data-spawn-field="x" data-spawn-index="${index}" type="number" step="0.05" value="${fmt(point.x)}"></label>
        <label>Y<input data-spawn-field="y" data-spawn-index="${index}" type="number" step="0.05" value="${fmt(point.y)}"></label>
        <label>Z<input data-spawn-field="z" data-spawn-index="${index}" type="number" step="0.05" value="${fmt(point.z)}"></label>
        <label>RY<input data-spawn-field="angle" data-spawn-index="${index}" type="number" step="5" value="${fmt(point.angle)}" title="Rotation around Y in degrees, relative to the part"></label>
        <button type="button" class="icon danger" data-action="delete-spawn" data-index="${index}" ${points.length <= 1 ? 'disabled' : ''}>x</button>
      </div>`,
    )
    .join('')
}

function spawnSection(points: SpawnPoint[]): string {
  return `<div class="group-head spawn-head">
      <h4>Spawn points</h4>
      <button type="button" data-action="add-spawn">+ point</button>
    </div>
    <p class="hint">Select a point to show its arrows, then drag them, the point, or the green ring to turn it. RY is the rotation around Y in degrees, relative to the part.</p>
    <div class="spawns">${spawnRows(points)}</div>`
}

function attackFields(attack: AttackDef | undefined): string {
  if (!attack) {
    return '<p class="hint">No attack. Pick a preset to add one.</p>'
  }
  if (attack.kind === 'cone') {
    return `<div class="row">
        <label>Cooldown<input data-attack-field="cooldown" type="number" step="0.05" min="0.01" value="${fmt(attack.cooldown)}"></label>
        <label>Range<input data-attack-field="range" type="number" step="0.1" min="0.01" value="${fmt(attack.cone.range)}"></label>
      </div>
      <div class="row">
        <label>Half angle<input data-attack-field="half-angle" type="number" step="1" min="1" max="180" value="${fmt(attack.cone.halfAngleDeg)}"></label>
        <label>Duration<input data-attack-field="duration" type="number" step="0.05" min="0.01" value="${fmt(attack.cone.duration)}"></label>
      </div>
      ${spawnSection(attack.cone.spawnPoints)}`
  }
  const projectile = attack.projectile
  return `<div class="row">
      <label>Cooldown<input data-attack-field="cooldown" type="number" step="0.05" min="0.01" value="${fmt(attack.cooldown)}"></label>
      <label>Speed<input data-attack-field="speed" type="number" step="0.5" min="0.01" value="${fmt(projectile.speed)}"></label>
    </div>
    <div class="row">
      <label>TTL<input data-attack-field="ttl" type="number" step="0.05" min="0.01" value="${fmt(projectile.ttl)}"></label>
      <label>Damage<input data-attack-field="damage" type="number" step="1" min="1" value="${projectile.damage}"></label>
    </div>
    <label>Visual<select data-attack-field="visual">${visualOptions(projectile.visual)}</select></label>
    <label class="check"><input data-attack-field="on-land" type="checkbox" ${projectile.onLand ? 'checked' : ''}>Leaves a hazard on land</label>
    ${
      projectile.onLand
        ? `<div class="row">
            <label>Delay<input data-attack-field="land-delay" type="number" step="0.05" min="0" value="${fmt(projectile.onLand.delay)}"></label>
            <label>Duration<input data-attack-field="land-duration" type="number" step="0.05" min="0.01" value="${fmt(projectile.onLand.duration)}"></label>
            <label>Radius<input data-attack-field="land-radius" type="number" step="0.1" min="0.01" value="${fmt(projectile.onLand.radius)}"></label>
          </div>`
        : ''
    }
    ${spawnSection(attack.projectile.spawnPoints)}`
}

function boxRows(): string {
  if (!current) {
    return ''
  }
  const boxes = current.draft.boxes
  return boxes
    .map((box, index) => {
      const rotation: [number, number, number] = box.rotation ?? [0, 0, 0]
      return `<div class="box-row${index === selectedBox ? ' selected' : ''}" data-box-index="${index}">
        <button type="button" class="box-index" data-action="select-box" data-index="${index}">${index + 1}</button>
        <label>CX<input data-box-field="center-x" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[0])}"></label>
        <label>CY<input data-box-field="center-y" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[1])}"></label>
        <label>CZ<input data-box-field="center-z" data-box-index="${index}" type="number" step="0.05" value="${fmt(box.center[2])}"></label>
        <label>SX<input data-box-field="size-x" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[0])}"></label>
        <label>SY<input data-box-field="size-y" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[1])}"></label>
        <label>SZ<input data-box-field="size-z" data-box-index="${index}" type="number" step="0.05" min="0.01" value="${fmt(box.size[2])}"></label>
        <label>RX<input data-box-field="rotation-x" data-box-index="${index}" type="number" step="1" value="${fmt(rotation[0])}" disabled title="Locked"></label>
        <label>RY<input data-box-field="rotation-y" data-box-index="${index}" type="number" step="1" value="${fmt(rotation[1])}"></label>
        <label>RZ<input data-box-field="rotation-z" data-box-index="${index}" type="number" step="1" value="${fmt(rotation[2])}" disabled title="Locked"></label>
        <label class="check"><input data-box-field="hitbox" data-box-index="${index}" type="checkbox" ${box.hitbox ? 'checked' : ''}>claw</label>
        <button type="button" class="icon danger" data-action="delete-box" data-index="${index}" ${boxes.length <= 1 ? 'disabled' : ''}>x</button>
      </div>`
    })
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
      <p class="hint">X and Z move the art only, in art units. Y is fixed by the part lift.</p>
      <div class="row">
        <label>X<input data-field="offset-x" type="number" step="0.05" value="${fmt(offset[0])}"></label>
        <label>Y<input type="number" value="0" disabled title="Fixed by the part lift"></label>
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
          ? `<p class="hint">C is the centre, S is the size. Green is a hurtbox, red is a hitbox. RX and RZ are locked; only RY can be edited.</p>
             <div class="boxes">${boxRows()}</div>`
          : '<p class="hint">Hidden. Drag the arrows to move the art, or tick Edit to change the boxes.</p>'
      }
    </section>
    <section class="group">
      <h3>Attack</h3>
      ${attackPresetSelect(draft.attack)}
      ${attackFields(draft.attack)}
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

function selectSpawn(index: number): void {
  if (!current || !Number.isInteger(index)) {
    return
  }
  const attack = current.draft.attack
  if (!attack) {
    return
  }
  selectedSpawn = Math.max(0, Math.min(index, attackSpawns(attack).length - 1))
  for (const row of inspector.querySelectorAll<HTMLElement>('.spawn-row')) {
    row.classList.toggle('selected', Number(row.dataset.spawnIndex) === selectedSpawn)
  }
  preview.selectSpawn(selectedSpawn)
}

/** The part itself owns the arrows when no muzzle is selected. */
function selectPartTarget(): void {
  if (!current) {
    return
  }
  selectedSpawn = -1
  for (const row of inspector.querySelectorAll<HTMLElement>('.spawn-row')) {
    row.classList.remove('selected')
  }
  preview.selectSpawn(-1)
}

function selectPart(slot: Slot, id: string): void {
  const target = parts.find((part) => part.slot === slot && part.draft.id === id)
  if (!target) {
    return
  }
  if (target === current) {
    selectPartTarget()
    return
  }
  if (dirty && !window.confirm('Discard unsaved changes?')) {
    return
  }
  current = target
  selectedBox = 0
  selectedSpawn = -1
  dirty = false
  pendingHistory = undefined
  renderList()
  renderInspector()
  applyPreview()
}

function setField(target: HTMLInputElement | HTMLSelectElement): void {
  if (!current) {
    return
  }
  if (target.dataset.field === 'collider-edit') {
    setEditColliders((target as HTMLInputElement).checked)
    return
  }
  if (target.dataset.field === 'attack-preset') {
    setAttackPreset(target.value)
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
    case 'rotation-y':
      box.rotation = [box.rotation?.[0] ?? 0, toNumber(target.value), box.rotation?.[2] ?? 0]
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

function setAttackPreset(value: string): void {
  if (!current || value === 'custom') {
    return
  }
  beginHistory()
  const preset = ATTACK_PRESETS.find((candidate) => candidate.id === value)
  current.draft.attack = preset?.create()
  selectedSpawn = -1
  renderInspector()
  applyPreview()
  markDirty()
}

function setAttackField(target: HTMLInputElement | HTMLSelectElement): void {
  const attack = current?.draft.attack
  const field = target.dataset.attackField
  if (!attack || !field) {
    return
  }
  commitPendingHistory()
  if (field === 'on-land') {
    if (attack.kind !== 'projectile') {
      return
    }
    if ((target as HTMLInputElement).checked) {
      attack.projectile.onLand = { delay: 0, duration: 0.5, radius: 1.5 }
    } else {
      delete attack.projectile.onLand
    }
    renderInspector()
    markDirty()
    return
  }
  if (attack.kind === 'cone') {
    switch (field) {
      case 'cooldown':
        attack.cooldown = toNumber(target.value)
        break
      case 'range':
        attack.cone.range = toNumber(target.value)
        break
      case 'half-angle':
        attack.cone.halfAngleDeg = toNumber(target.value)
        break
      case 'duration':
        attack.cone.duration = toNumber(target.value)
        break
      default:
        return
    }
    applyPreview()
    markDirty()
    return
  }
  const projectile = attack.projectile
  switch (field) {
    case 'cooldown':
      attack.cooldown = toNumber(target.value)
      break
    case 'speed':
      projectile.speed = toNumber(target.value)
      break
    case 'ttl':
      projectile.ttl = toNumber(target.value)
      break
    case 'damage':
      projectile.damage = toNumber(target.value)
      break
    case 'visual':
      projectile.visual = target.value
      break
    case 'land-delay':
      if (projectile.onLand) {
        projectile.onLand.delay = toNumber(target.value)
      }
      break
    case 'land-duration':
      if (projectile.onLand) {
        projectile.onLand.duration = toNumber(target.value)
      }
      break
    case 'land-radius':
      if (projectile.onLand) {
        projectile.onLand.radius = toNumber(target.value)
      }
      break
    default:
      return
  }
  markDirty()
}

function setSpawnField(target: HTMLInputElement): void {
  const attack = current?.draft.attack
  if (!attack) {
    return
  }
  const index = Number(target.dataset.spawnIndex)
  const point = attackSpawns(attack)[index]
  if (!point) {
    return
  }
  commitPendingHistory()
  switch (target.dataset.spawnField) {
    case 'x':
      point.x = toNumber(target.value)
      break
    case 'y':
      point.y = toNumber(target.value)
      break
    case 'z':
      point.z = toNumber(target.value)
      break
    case 'angle':
      point.angle = toNumber(target.value)
      break
    default:
      return
  }
  selectedSpawn = index
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
    clampSelectedSpawn()
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

function addSpawn(): void {
  const attack = current?.draft.attack
  if (!attack) {
    return
  }
  const points = attackSpawns(attack)
  beginHistory()
  points.push(
    attack.kind === 'cone'
      ? { x: 0, y: DEFAULT_SPAWN_Y, z: 0, angle: 0 }
      : { x: 0, y: DEFAULT_SPAWN_Y, z: 1.96, angle: 0 },
  )
  selectedSpawn = points.length - 1
  renderInspector()
  applyPreview()
  markDirty()
}

function deleteSpawn(index: number): void {
  const attack = current?.draft.attack
  if (!attack || attackSpawns(attack).length <= 1) {
    return
  }
  beginHistory()
  attackSpawns(attack).splice(index, 1)
  if (selectedSpawn > index) {
    selectedSpawn -= 1
  }
  clampSelectedSpawn()
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
  const part: LoadedPart = { slot, file: `${id}.json`, draft, isNew: true }
  parts.push(part)
  current = part
  selectedBox = 0
  selectedSpawn = -1
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
    selectedSpawn = -1
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
  if (action === 'add-spawn') {
    addSpawn()
    return
  }
  if (action === 'delete-spawn') {
    const index = Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)
    if (Number.isInteger(index)) {
      deleteSpawn(index)
    }
    return
  }
  if (action === 'select-spawn') {
    const index = Number(target.closest<HTMLElement>('[data-index]')?.dataset.index)
    if (Number.isInteger(index)) {
      selectSpawn(index)
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
  if (target.closest('[data-field], [data-box-field], [data-attack-field], [data-spawn-field]')) {
    pendingHistory = { part: current, snapshot: cloneDraft(current.draft) }
  }
  const spawnField = target.closest<HTMLElement>('[data-spawn-field]')
  if (spawnField) {
    selectSpawn(Number(spawnField.dataset.spawnIndex))
  }
})

inspector.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement
  if (target.dataset.field) {
    setField(target)
  } else if (target.dataset.boxField) {
    setBoxField(target)
  } else if (target.dataset.attackField) {
    setAttackField(target)
  } else if (target.dataset.spawnField) {
    setSpawnField(target)
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
