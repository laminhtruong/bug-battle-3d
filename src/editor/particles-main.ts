import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  ApplyForce,
  BatchedRenderer,
  CircleEmitter,
  ColorOverLife,
  ConeEmitter,
  ConstantColor,
  ConstantValue,
  DonutEmitter,
  FrameOverLife,
  Gradient,
  GridEmitter,
  HemisphereEmitter,
  IntervalValue,
  ParticleSystem,
  PiecewiseBezier,
  PointEmitter,
  QuarksLoader,
  QuarksUtil,
  RectangleEmitter,
  RenderMode,
  SizeOverLife,
  SphereEmitter,
  Vector3 as QVector3,
  Vector4 as QVector4,
  Bezier,
} from 'three.quarks'
import { asset } from '@/core/asset'
import { parseQuarksDocument, type QuarksDocument } from '@/content/particles'
import './particles.css'

const root = document.querySelector<HTMLElement>('#particle-editor')
if (!root) throw new Error('missing #particle-editor')

root.innerHTML = `
  <div class="studio">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">\u{2733}</div><div><div class="brand-title">QUARKS STUDIO</div><div class="brand-subtitle">Native ParticleEmitter JSON</div></div></div>
      <div class="top-actions"><button class="btn ghost" type="button" data-action="undo" title="Undo (Ctrl+Z)" disabled>Undo</button><button class="btn ghost" type="button" data-action="redo" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button><span class="save-state" data-save-state>All changes saved</span><a class="top-link" href="/editor.html">Part editor \u{2197}</a><button class="btn" type="button" data-action="import">Import JSON</button><button class="btn" type="button" data-action="export">Export JSON</button><button class="btn primary" type="button" data-action="save">Save effect&nbsp; <span>Ctrl+S</span></button></div>
    </header>
    <main class="workspace">
      <aside class="left-panel">
        <section class="panel-block">
          <div class="section-title"><span>Effects library</span><span class="count" data-effect-count>00</span></div>
          <input class="search" type="search" placeholder="Search effects\u{2026}" aria-label="Search effects" data-search>
          <div class="effect-list" data-effect-list></div>
          <div class="system-actions"><button class="btn small" type="button" data-action="new">+ New effect</button><button class="btn small" type="button" data-action="duplicate" title="Duplicate selected effect">Copy</button></div>
        </section>
        <section class="panel-block">
          <div class="section-title"><span>Hierarchy</span><span class="count" data-system-count>00</span></div>
          <div data-system-list></div>
          <div class="system-actions"><button class="btn small" type="button" data-action="add-system">+ Add</button><button class="btn small" type="button" data-action="duplicate-system" title="Duplicate selected system">Copy</button><button class="btn small" type="button" data-action="move-system-up" title="Move system up">Up</button><button class="btn small" type="button" data-action="move-system-down" title="Move system down">Down</button><button class="btn small danger" type="button" data-action="remove-system" title="Remove selected system">-</button></div>
        </section>
        <section class="panel-block"><div class="section-title"><span>Shortcuts</span></div><div class="hint">Space \u{b7} Play / pause<br>Ctrl+Z / Ctrl+Shift+Z \u{b7} Undo / redo<br>Ctrl+S \u{b7} Save native JSON<br>Drag \u{b7} Orbit camera&nbsp; \u{b7} &nbsp;Scroll \u{b7} Zoom</div></section>
      </aside>
      <section class="stage">
        <div class="viewport">
          <canvas id="vfx-canvas" aria-label="Particle effect preview"></canvas>
          <div class="viewport-label"><strong>Scene view</strong><span>Quarks runtime \u{b7} Perspective</span></div>
          <div class="view-badge">REAL-TIME PREVIEW</div>
          <div class="viewport-actions"><button class="btn" type="button" data-action="frame">Frame</button><button class="btn" type="button" data-action="grid">Grid</button></div>
        </div>
        <div class="timeline">
          <div class="transport"><button class="btn" type="button" data-action="restart" title="Restart (R)">Restart</button><button class="btn primary" type="button" data-action="play" title="Play / pause (Space)" data-play>Play</button><button class="btn" type="button" data-action="step" title="Step frame">Step</button><div class="time-readout"><span data-time>0.00</span> <span>/</span> <span data-duration>0.00 s</span></div></div>
          <div class="timeline-track"><div class="timeline-progress" data-progress></div><div class="timeline-knob" data-knob></div><div class="timeline-ticks"><span>0s</span><span>25%</span><span>50%</span><span>75%</span><span data-end-tick>1s</span></div><input class="timeline-input" type="range" min="0" max="1000" value="0" aria-label="Preview timeline" data-timeline></div>
        </div>
      </section>
      <aside class="right-panel" data-inspector></aside>
    </main>
  </div>
  <input type="file" accept="application/json,.json" hidden data-file-input>
  <div class="toast" hidden></div>
`

type NativeNode = {
  type: string
  name?: string
  children?: NativeNode[]
  ps?: Record<string, unknown>
  [key: string]: unknown
}
interface EffectFile {
  id: string
  json: QuarksDocument
}
interface EmitterObject extends THREE.Object3D {
  system: ParticleSystem
}

const $ = <T extends Element>(selector: string): T => {
  const element = root!.querySelector<T>(selector)
  if (!element) throw new Error(`missing ${selector}`)
  return element
}
const canvas = $<HTMLCanvasElement>('#vfx-canvas')
const inspector = $<HTMLElement>('[data-inspector]')
const toast = $<HTMLElement>('.toast')
const effectList = $<HTMLElement>('[data-effect-list]')
const systemList = $<HTMLElement>('[data-system-list]')
const saveState = $<HTMLElement>('[data-save-state]')
const textures = new Set<string>()
const bundled = Object.entries(
  import.meta.glob('../content/particles/*.json', { eager: true, import: 'default' }),
).map(([file, json]) => ({
  id: file
    .split('/')
    .at(-1)!
    .replace(/\.json$/, ''),
  json: parseQuarksDocument(json),
}))
const bundledById = new Map(bundled.map((effect) => [effect.id, effect]))
let effects = bundled.map((effect) => structuredClone(effect))
const savedIds = new Set<string>()
let currentId = effects[0]?.id ?? ''
let systemIndex = 0
let dirty = false
let playing = true
let showGrid = true
let elapsed = 0
let previousFrame = 0
let frameRequest = 0
let toastTimer = 0
let previewTimer = 0
let previewDuration = 1
let currentGroup: THREE.Object3D | undefined
let previewSystems: ParticleSystem[] = []
let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let batch: BatchedRenderer
let grid: THREE.GridHelper
const undoStack: EffectFile[] = []
const redoStack: EffectFile[] = []

const currentEffect = (): EffectFile | undefined =>
  effects.find((effect) => effect.id === currentId)
const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const num = (value: number, digits = 2): string =>
  Number.isFinite(value) ? Number(value.toFixed(digits)).toString() : '0'
const asHex = (rgb: readonly number[]): string =>
  `#${rgb
    .slice(0, 3)
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
const fromHex = (hex: string): [number, number, number] =>
  [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ]

function emitterNodes(rootNode: NativeNode): NativeNode[] {
  const found: NativeNode[] = []
  const visit = (node: NativeNode) => {
    if (node.type === 'ParticleEmitter') found.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(rootNode)
  return found
}

function nativeRoot(json: QuarksDocument): NativeNode {
  return json.object as unknown as NativeNode
}

function displayName(effect: EffectFile): string {
  return String(nativeRoot(effect.json).name || effect.id)
}

function rootRotation(effect: EffectFile): THREE.Euler {
  const matrix = nativeRoot(effect.json).matrix
  const transform = Array.isArray(matrix)
    ? new THREE.Matrix4().fromArray(matrix as number[])
    : new THREE.Matrix4()
  return new THREE.Euler().setFromRotationMatrix(transform)
}

function emitters(group = currentGroup): EmitterObject[] {
  const result: EmitterObject[] = []
  group?.traverse((object) => {
    if (object.type === 'ParticleEmitter' && 'system' in object)
      result.push(object as EmitterObject)
  })
  return result
}

function currentEmitter(): EmitterObject | undefined {
  return emitters()[systemIndex]
}

function flash(message: string, error = false): void {
  toast.textContent = message
  toast.classList.toggle('error', error)
  toast.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toast.hidden = true
  }, 3000)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/editor/api${path}`, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

function markDirty(): void {
  dirty = true
  saveState.textContent = 'Unsaved changes'
  saveState.classList.add('dirty')
}

function setSaved(): void {
  dirty = false
  saveState.textContent = 'All changes saved'
  saveState.classList.remove('dirty')
}

function updateHistoryButtons(): void {
  $<HTMLButtonElement>('[data-action="undo"]').disabled = undoStack.length === 0
  $<HTMLButtonElement>('[data-action="redo"]').disabled = redoStack.length === 0
}

function syncEffect(): void {
  const effect = currentEffect()
  if (!effect || !currentGroup) return
  nativeRoot(effect.json).name = currentGroup.name || effect.id
  effect.json = serializeGroup(currentGroup)
}

function recordHistory(): void {
  syncEffect()
  const effect = currentEffect()
  if (!effect) return
  undoStack.push(structuredClone(effect))
  if (undoStack.length > 100) undoStack.shift()
  redoStack.length = 0
  updateHistoryButtons()
}

function travelHistory(from: EffectFile[], to: EffectFile[]): void {
  syncEffect()
  const effect = currentEffect()
  const snapshot = from.pop()
  if (!effect || !snapshot) return
  to.push(structuredClone(effect))
  releasePreview()
  effects = effects.map((item) => (item.id === currentId ? snapshot : item))
  systemIndex = Math.min(systemIndex, emitterNodes(nativeRoot(snapshot.json)).length - 1)
  markDirty()
  renderEffects()
  renderSystems()
  renderInspector()
  resetPreview()
  updateHistoryButtons()
}

function isBuiltIn(id: string): boolean {
  return bundledById.has(id)
}

function renderEffects(): void {
  const query = $<HTMLInputElement>('[data-search]').value.trim().toLowerCase()
  const visible = effects.filter((effect) =>
    `${displayName(effect)} ${effect.id}`.toLowerCase().includes(query),
  )
  $('[data-effect-count]').textContent = String(effects.length).padStart(2, '0')
  effectList.innerHTML = visible.length
    ? visible
        .map(
          (effect) => `
    <button class="effect-item${effect.id === currentId ? ' active' : ''}" type="button" data-effect="${esc(effect.id)}"><span class="effect-icon">\u{2733}</span><span><span class="effect-name">${esc(displayName(effect))}</span><span class="effect-meta">${esc(effect.id)} \u{b7} ${emitterNodes(nativeRoot(effect.json)).length} systems</span></span>${savedIds.has(effect.id) ? '<span class="saved-dot" title="Saved to project"></span>' : ''}</button>`,
        )
        .join('')
    : '<div class="empty-list">No matching effects</div>'
}

function renderSystems(): void {
  const effect = currentEffect()
  const nodes = effect ? emitterNodes(nativeRoot(effect.json)) : []
  $('[data-system-count]').textContent = String(nodes.length).padStart(2, '0')
  if (!effect) {
    systemList.innerHTML = '<div class="empty-list">Create or import an effect.</div>'
    return
  }
  systemList.innerHTML = `<div class="hierarchy-row"><span>\u{2304}</span><span class="tree-icon">\u{2733}</span><strong>${esc(displayName(effect))}</strong><span class="row-meta">GROUP</span></div>${nodes.map((node, index) => `<button class="hierarchy-row${index === systemIndex ? ' active' : ''}" type="button" data-system="${index}"><span class="tree-indent"></span><span class="tree-icon">\u{25a7}</span><span>${esc(node.name || `Particle System ${index + 1}`)}</span><span class="row-meta">${index + 1}</span></button>`).join('')}`
}

function intervalBounds(generator: unknown, fallback: [number, number]): [number, number] {
  if (!generator || typeof generator !== 'object') return fallback
  const value = generator as { type?: string; a?: number; b?: number; value?: number }
  if (value.type === 'IntervalValue') return [value.a ?? fallback[0], value.b ?? fallback[1]]
  if (value.type === 'ConstantValue')
    return [value.value ?? fallback[0], value.value ?? fallback[1]]
  return fallback
}

function colorOf(system: ParticleSystem): [number, number, number, number] {
  const color = (system.startColor as unknown as { color?: QVector4 }).color
  return color ? [color.x, color.y, color.z, color.w] : [1, 1, 1, 1]
}

function colorStops(
  system: ParticleSystem,
): { colors: [number, number, number, number][]; alphas: [number, number][] } | undefined {
  const behavior = system.behaviors.find((item) => item.type === 'ColorOverLife') as
    ColorOverLife | undefined
  if (!behavior || !(behavior.color instanceof Gradient)) return undefined
  return {
    colors: behavior.color.color.keys.map(([value, time]) => [time, value.x, value.y, value.z]),
    alphas: behavior.color.alpha.keys.map(([value, time]) => [time, value]),
  }
}

function sizeCurve(system: ParticleSystem): [number, number][] | undefined {
  const behavior = system.behaviors.find((item) => item.type === 'SizeOverLife') as
    SizeOverLife | undefined
  const curve = behavior?.size as unknown as
    { functions?: Array<[{ p: number[] }, number]> } | undefined
  const segments = curve?.functions
  if (!segments?.length) return undefined
  const points = segments.map(([bezier, time]) => [time, bezier.p[0] ?? 1] as [number, number])
  const last = segments.at(-1)?.[0]
  points.push([1, last?.p[3] ?? 1])
  return points
}

function frameRange(system: ParticleSystem): [number, number] | undefined {
  const behavior = system.behaviors.find((item) => item.type === 'FrameOverLife') as
    FrameOverLife | undefined
  const data = behavior?.frame as unknown as
    { functions?: Array<[{ p: number[] }, number]> } | undefined
  const segment = data?.functions?.[0]
  const curve = segment?.[0]
  return curve ? [curve.p[0] ?? 0, data!.functions!.at(-1)?.[0].p[3] ?? 0] : undefined
}

function setFrameRange(system: ParticleSystem, start: number, end: number): void {
  const frame = new FrameOverLife(
    linearCurve([
      [0, start],
      [1, end],
    ]),
  )
  const current = system.behaviors.findIndex((item) => item.type === 'FrameOverLife')
  if (current >= 0) system.behaviors[current] = frame
  else system.behaviors.push(frame)
}

function gravityOf(system: ParticleSystem): number {
  const behavior = system.behaviors.find((item) => item.type === 'ApplyForce') as
    ApplyForce | undefined
  if (!behavior) return 0
  const strength = behavior.magnitude as unknown as { value?: number }
  return behavior.direction.y * (strength.value ?? 0)
}

function materialOf(system: ParticleSystem): { name: string; additive: boolean } {
  const material = system.material as THREE.MeshBasicMaterial
  const image = material.map?.image as { src?: string } | undefined
  const src = image?.src ?? ''
  const filename = typeof src === 'string' ? (src.split(/[/?#]/).at(-1) ?? '') : ''
  return {
    name: textures.has(filename.replace(/\.png$/i, ''))
      ? filename.replace(/\.png$/i, '')
      : ([...textures][0] ?? 'circle'),
    additive: material.blending === THREE.AdditiveBlending,
  }
}

function shapeFields(system: ParticleSystem): string {
  const shape = system.emitterShape
  const data = shape as unknown as Record<string, unknown>
  const fields: { key: string; title: string; value: number; step: number }[] = []
  for (const key of ['radius', 'width', 'height', 'row', 'column', 'donutRadius', 'thickness']) {
    if (key in shape)
      fields.push({
        key,
        title: key.toUpperCase(),
        value: Number(data[key]),
        step: key === 'row' || key === 'column' ? 1 : 0.05,
      })
  }
  if (shape.type === 'cone' || shape.type === 'sphere' || shape.type === 'hemisphere')
    fields.push({
      key: 'angle',
      title: 'ANGLE \u{b7} DEG',
      value: ((data.angle as number) * 180) / Math.PI,
      step: 1,
    })
  if ('arc' in shape)
    fields.push({
      key: 'arc',
      title: 'ARC \u{b7} DEG',
      value: ((data.arc as number) * 180) / Math.PI,
      step: 1,
    })
  if ('spread' in shape)
    fields.push({ key: 'spread', title: 'SPREAD', value: Number(data.spread), step: 0.05 })
  const controls = fields.map(
    ({ key, title, value, step }) =>
      `<label class="field"><span>${title}</span><input type="number" min="0" step="${step}" value="${num(value)}" data-bind="shape.${key}"></label>`,
  )
  if ('mode' in shape)
    controls.push(
      `<label class="field"><span>EMITTER MODE</span><select data-bind="shape.mode">${[
        ['0', 'Random'],
        ['1', 'Loop'],
        ['2', 'Ping-pong'],
        ['3', 'Burst'],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${String(data.mode) === value ? 'selected' : ''}>${label}</option>`,
        )
        .join('')}</select></label>`,
    )
  return (
    controls.join('') || '<p class="hint">This native emitter shape has no scalar parameters.</p>'
  )
}

function renderColorStops(system: ParticleSystem): string {
  const stops = colorStops(system)
  if (!stops)
    return '<button class="btn small" type="button" data-action="enable-color">+ Add color over life</button>'
  const colors = stops.colors
    .map(
      ([time, r, g, b], index) =>
        `<div class="color-stop"><input type="number" min="0" max="1" step="0.01" value="${num(time, 3)}" aria-label="Color stop time" data-color-stop="${index}" data-color-part="time"><input type="color" value="${asHex([r, g, b])}" aria-label="Color stop color" data-color-stop="${index}" data-color-part="color"><button class="btn small danger" type="button" data-action="remove-color" data-index="${index}" title="Remove key">&times;</button></div>`,
    )
    .join('')
  const alphas = stops.alphas
    .map(
      ([time, value], index) =>
        `<div class="color-stop"><input type="number" min="0" max="1" step="0.01" value="${num(time, 3)}" aria-label="Alpha stop time" data-alpha-stop="${index}" data-alpha-part="time"><input type="number" min="0" max="1" step="0.01" value="${num(value, 3)}" aria-label="Alpha" data-alpha-stop="${index}" data-alpha-part="value"><button class="btn small danger" type="button" data-action="remove-alpha" data-index="${index}" title="Remove key">&times;</button></div>`,
    )
    .join('')
  return `<div class="asset-heading"><span>COLOR KEYS \u{b7} T / RGB</span><button class="btn small" type="button" data-action="add-color">+ Key</button></div>${colors}<div class="asset-heading" style="margin-top:12px"><span>ALPHA KEYS \u{b7} T / VALUE</span><button class="btn small" type="button" data-action="add-alpha">+ Key</button></div>${alphas}`
}

function renderInspector(): void {
  const effect = currentEffect()
  const emitter = currentEmitter()
  const system = emitter?.system
  if (!effect || !system) {
    inspector.innerHTML = '<div class="empty-list">Select or create a Quarks effect.</div>'
    return
  }
  const life = intervalBounds(system.startLife, [1, 1])
  const speed = intervalBounds(system.startSpeed, [0, 0])
  const size = intervalBounds(system.startSize, [1, 1])
  const rotation = intervalBounds(system.startRotation, [0, 0])
  const color = colorOf(system)
  const material = materialOf(system)
  const effectRotation = rootRotation(effect)
  const burst = system.emissionBursts[0]
  const burstCount = burst ? intervalBounds(burst.count, [0, 0])[1] : 0
  const curve = sizeCurve(system)
  const modes = [
    [RenderMode.BillBoard, 'Billboard'],
    [RenderMode.StretchedBillBoard, 'Stretched Billboard'],
    [RenderMode.HorizontalBillBoard, 'Horizontal Billboard'],
    [RenderMode.VerticalBillBoard, 'Vertical Billboard'],
    [RenderMode.Trail, 'Trail'],
    [RenderMode.Mesh, 'Mesh'],
  ] as const
  const textureOptions = [...textures]
    .map(
      (name) =>
        `<option value="${esc(name)}" ${name === material.name ? 'selected' : ''}>${esc(name)}</option>`,
    )
    .join('')
  const shapeKinds = [
    'point',
    'cone',
    'sphere',
    'hemisphere',
    'circle',
    'donut',
    'rectangle',
    'grid',
  ]
  inspector.innerHTML = `
    <header class="inspector-head"><div class="inspector-kicker">${isBuiltIn(effect.id) ? 'QUARKS PRESET' : 'NATIVE QUARKS EFFECT'} \u{b7} SYSTEM ${String(systemIndex + 1).padStart(2, '0')}</div><input class="inspector-title" value="${esc(displayName(effect))}" aria-label="Effect name" data-bind="effect.name"><div class="inspector-sub">${esc(effect.id)} <span>\u{b7}</span> ${emitters().length} ParticleEmitter${emitters().length === 1 ? '' : 's'}</div></header>
    <section class="inspect-section"><h3>Effect object rotation</h3><div class="field-grid">
      <label class="field"><span>ROTATION X \u{b7} DEG</span><input type="number" min="-360" max="360" step="1" value="${num((effectRotation.x * 180) / Math.PI)}" data-bind="effect.rotation.x"></label>
      <label class="field"><span>ROTATION Y \u{b7} DEG</span><input type="number" min="-360" max="360" step="1" value="${num((effectRotation.y * 180) / Math.PI)}" data-bind="effect.rotation.y"></label>
      <label class="field"><span>ROTATION Z \u{b7} DEG</span><input type="number" min="-360" max="360" step="1" value="${num((effectRotation.z * 180) / Math.PI)}" data-bind="effect.rotation.z"></label>
    </div><p class="hint">Rotates the native root Group and all its emitters. Angles are degrees.</p></section>
    <section class="inspect-section"><h3>Emission</h3><div class="field-grid">
      <label class="field"><span>DURATION \u{b7} S</span><input type="number" min="0.01" step="0.05" value="${num(system.duration)}" data-bind="duration"></label>
      <label class="field"><span>RATE \u{b7} /SEC</span><input type="number" min="0" step="1" value="${num(intervalBounds(system.emissionOverTime, [0, 0])[1])}" data-bind="rate"></label>
      <label class="field"><span>RATE \u{b7} DISTANCE</span><input type="number" min="0" step="0.1" value="${num(intervalBounds(system.emissionOverDistance, [0, 0])[1])}" data-bind="distanceRate"></label>
      <label class="field"><span>LIFETIME \u{b7} MIN</span><input type="number" min="0.01" step="0.05" value="${num(life[0])}" data-bind="life.0"></label>
      <label class="field"><span>LIFETIME \u{b7} MAX</span><input type="number" min="0.01" step="0.05" value="${num(life[1])}" data-bind="life.1"></label>
      <label class="field"><span>BURST COUNT</span><input type="number" min="0" step="1" value="${num(burstCount)}" data-bind="burst.count"></label>
      <label class="field"><span>BURST TIME \u{b7} S</span><input type="number" min="0" step="0.05" value="${num(burst?.time ?? 0)}" data-bind="burst.time"></label>
      <label class="check-field"><input type="checkbox" ${system.looping ? 'checked' : ''} data-bind="looping"> Loop system</label>
      <label class="check-field"><input type="checkbox" ${system.worldSpace ? 'checked' : ''} data-bind="worldSpace"> World space</label>
      <label class="check-field"><input type="checkbox" ${system.prewarm ? 'checked' : ''} data-bind="prewarm"> Prewarm</label>
      <label class="check-field"><input type="checkbox" ${system.autoDestroy ? 'checked' : ''} data-bind="autoDestroy"> Auto destroy</label>
    </div><p class="hint">Rate and bursts map to native Quarks emissionOverTime/emissionBursts.</p></section>
    <section class="inspect-section"><h3>Initial properties & shape</h3><div class="field-grid">
      <label class="field"><span>SPEED \u{b7} MIN</span><input type="number" min="0" step="0.5" value="${num(speed[0])}" data-bind="speed.0"></label>
      <label class="field"><span>SPEED \u{b7} MAX</span><input type="number" min="0" step="0.5" value="${num(speed[1])}" data-bind="speed.1"></label>
      <label class="field"><span>SIZE \u{b7} MIN</span><input type="number" min="0.01" step="0.05" value="${num(size[0])}" data-bind="size.0"></label>
      <label class="field"><span>SIZE \u{b7} MAX</span><input type="number" min="0.01" step="0.05" value="${num(size[1])}" data-bind="size.1"></label>
      <label class="field"><span>ROTATION \u{b7} MIN DEG</span><input type="number" step="5" value="${num((rotation[0] * 180) / Math.PI)}" data-bind="rotation.0"></label>
      <label class="field"><span>ROTATION \u{b7} MAX DEG</span><input type="number" step="5" value="${num((rotation[1] * 180) / Math.PI)}" data-bind="rotation.1"></label>
      <label class="field"><span>EMITTER SHAPE</span><select data-bind="shape.kind">${shapeKinds.map((kind) => `<option value="${kind}" ${system.emitterShape.type === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
      ${shapeFields(system)}
      <label class="field"><span>GRAVITY Y</span><input type="number" step="0.5" value="${num(gravityOf(system))}" data-bind="gravity"></label>
    </div></section>
    <section class="inspect-section"><h3>Renderer & material</h3><div class="field-grid">
      <label class="field full"><span>TEXTURE</span><select data-bind="material">${textureOptions}</select></label>
      <div class="field full"><img class="asset-preview" src="${asset(`textures/fx/${material.name}.png`)}" alt="${esc(material.name)} texture"></div>
      <label class="field full"><span>RENDER MODE</span><select data-bind="renderMode">${modes.map(([mode, label]) => `<option value="${mode}" ${system.renderMode === mode ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="field"><span>BLENDING</span><select data-bind="additive"><option value="true" ${material.additive ? 'selected' : ''}>Additive</option><option value="false" ${material.additive ? '' : 'selected'}>Alpha</option></select></label>
      <label class="field"><span>START COLOR</span><input type="color" value="${asHex(color)}" data-bind="startColor"></label>
      <label class="field"><span>START ALPHA</span><input type="number" min="0" max="1" step="0.05" value="${num(color[3])}" data-bind="startAlpha"></label>
    </div><p class="hint">These controls update a live Quarks ParticleSystem, not an editor-specific particle schema.</p></section>
    <section class="inspect-section"><h3>Size over lifetime</h3>${curve ? '<div class="curve-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none" data-curve></svg><span class="curve-label">0 \u{2192} LIFE \u{2192} 100%</span></div><div class="curve-tools"><span>Quarks PiecewiseBezier</span><div><button class="btn" type="button" data-action="add-curve-key">+ Key</button> <button class="btn" type="button" data-action="remove-curve-key">- Key</button></div></div>' : '<button class="btn small" type="button" data-action="enable-curve">+ Add SizeOverLife</button>'}</section>
    <section class="inspect-section"><h3>Color over lifetime</h3>${renderColorStops(system)}</section>
    <section class="inspect-section"><h3>Texture sheet</h3><div class="field-grid"><label class="field"><span>TILE X</span><input type="number" min="1" step="1" value="${system.uTileCount}" data-bind="uTileCount"></label><label class="field"><span>TILE Y</span><input type="number" min="1" step="1" value="${system.vTileCount}" data-bind="vTileCount"></label><label class="field"><span>START TILE</span><input type="number" min="0" step="1" value="${intervalBounds(system.startTileIndex, [0, 0])[1]}" data-bind="startTileIndex"></label><label class="check-field"><input type="checkbox" ${system.blendTiles ? 'checked' : ''} data-bind="blendTiles"> Blend frames</label>${frameRange(system) ? `<label class="field"><span>FRAME START</span><input type="number" step="1" value="${num(frameRange(system)![0])}" data-bind="frame.start"></label><label class="field"><span>FRAME END</span><input type="number" step="1" value="${num(frameRange(system)![1])}" data-bind="frame.end"></label>` : '<button class="btn small" type="button" data-action="enable-frame">+ Add FrameOverLife</button>'}</div><p class="hint">Animation uses Quarks' native FrameOverLife behavior.</p></section>
    <section class="inspect-section"><details class="native-json"><summary>Native Quarks JSON</summary><textarea spellcheck="false" aria-label="Native Quarks JSON" data-native-json>${esc(JSON.stringify(effect.json, null, 2))}</textarea><button class="btn small" type="button" data-action="apply-json">Apply document</button></details></section>
    <section class="inspect-section"><button class="btn danger small" type="button" data-action="delete-effect" ${isBuiltIn(effect.id) ? 'disabled title="Bundled Quarks documents cannot be deleted"' : ''}>Delete custom effect</button>${isBuiltIn(effect.id) && savedIds.has(effect.id) ? '<button class="btn small" type="button" data-action="reset-effect">Reset preset</button>' : ''}</section>`
  if (curve) drawCurve($<SVGSVGElement>('[data-curve]'), curve)
}

function drawCurve(svg: SVGSVGElement, points: readonly (readonly [number, number])[]): void {
  const d = points
    .map(
      ([time, value], index) =>
        `${index === 0 ? 'M' : 'L'} ${(time * 100).toFixed(2)} ${(90 - value * 45).toFixed(2)}`,
    )
    .join(' ')
  svg.innerHTML = `<path class="curve-path" d="${d}"/>${points.map(([time, value], index) => `<circle class="curve-point" cx="${(time * 100).toFixed(2)}" cy="${(90 - value * 45).toFixed(2)}" r="${index === 0 || index === points.length - 1 ? 3.2 : 4}" data-curve-index="${index}"/>`).join('')}`
}

function curveFromSystem(system: ParticleSystem): [number, number][] | undefined {
  const behavior = system.behaviors.find((item) => item.type === 'SizeOverLife') as
    SizeOverLife | undefined
  const data = behavior?.size as unknown as
    { functions?: Array<[{ p: number[] }, number]> } | undefined
  const segments = data?.functions
  if (!segments?.length) return undefined
  const points = segments.map(([bezier, time]) => [time, bezier.p[0] ?? 1] as [number, number])
  points.push([1, segments.at(-1)?.[0].p[3] ?? 1])
  return points
}

function linearCurve(points: readonly (readonly [number, number])[]): PiecewiseBezier {
  const first = points[0] ?? [0, 1]
  const last = points.at(-1) ?? [1, 1]
  const keys = [
    [0, first[1]] as const,
    ...points.filter(([time]) => time > 0 && time < 1),
    [1, last[1]] as const,
  ]
  return new PiecewiseBezier(
    keys.slice(0, -1).map(([time, value], index) => {
      const nextValue = keys[index + 1]![1]
      const delta = nextValue - value
      return [new Bezier(value, value + delta / 3, value + (delta * 2) / 3, nextValue), time]
    }),
  )
}

function setSizeCurve(
  system: ParticleSystem,
  points: readonly (readonly [number, number])[],
): void {
  const current = system.behaviors.find((item) => item.type === 'SizeOverLife') as
    SizeOverLife | undefined
  if (current) current.size = linearCurve(points)
  else system.behaviors.push(new SizeOverLife(linearCurve(points)))
}

function setColorGradient(
  system: ParticleSystem,
  colors: readonly (readonly [number, number, number, number])[],
  alphas: readonly (readonly [number, number])[],
): void {
  const gradient = new Gradient(
    colors.map(([time, r, g, b]) => [new QVector3(r, g, b), time]),
    alphas.map(([time, alpha]) => [alpha, time]),
  )
  const current = system.behaviors.find((item) => item.type === 'ColorOverLife') as
    ColorOverLife | undefined
  if (current) current.color = gradient
  else system.behaviors.push(new ColorOverLife(gradient))
}

function serializeGroup(group: THREE.Object3D): QuarksDocument {
  const json = group.toJSON() as unknown as QuarksDocument
  const urls = new Map<string, string>()
  group.traverse((object) => {
    if (object.type !== 'ParticleEmitter' || !('system' in object)) return
    const material = (object as EmitterObject).system.material as THREE.MeshBasicMaterial
    const texture = material.map
    const source = texture?.image as { src?: string } | undefined
    if (!texture) return
    if (source?.src) {
      const marker = source.src.lastIndexOf('/assets/')
      urls.set(texture.uuid, marker >= 0 ? source.src.slice(marker + 1) : source.src)
    } else if (texture.name) urls.set(texture.uuid, `assets/textures/fx/${texture.name}.png`)
  })
  const parsed = json as unknown as {
    textures?: { uuid: string; image: string }[]
    images?: { uuid: string; url: unknown }[]
  }
  const urlsByImage = new Map(
    (parsed.textures ?? []).map((texture) => [texture.image, urls.get(texture.uuid)]),
  )
  for (const image of parsed.images ?? []) {
    const url = urlsByImage.get(image.uuid)
    if (url) image.url = url
  }
  return parseQuarksDocument(json)
}

function renderTransport(): void {
  const fraction = Math.max(0, Math.min(1, elapsed / previewDuration))
  $('[data-progress]').setAttribute('style', `width:${fraction * 100}%`)
  $('[data-knob]').setAttribute('style', `left:${fraction * 100}%`)
  $('[data-time]').textContent = elapsed.toFixed(2)
  $('[data-duration]').textContent = `${previewDuration.toFixed(2)} s`
  $('[data-end-tick]').textContent = `${previewDuration.toFixed(1)}s`
  $<HTMLButtonElement>('[data-play]').textContent = playing ? 'Pause' : 'Play'
  $<HTMLInputElement>('[data-timeline]').value = String(Math.round(fraction * 1000))
}

function resetPreview(): void {
  syncEffect()
  releasePreview()
  scene.remove(batch)
  batch = new BatchedRenderer()
  scene.add(batch)
  const effect = currentEffect()
  if (effect) {
    currentGroup = new QuarksLoader().parse(structuredClone(effect.json))
    currentGroup.name = displayName(effect)
    scene.add(currentGroup)
    QuarksUtil.addToBatchRenderer(currentGroup, batch)
    previewSystems = emitters(currentGroup).map((emitter) => emitter.system)
    previewDuration = Math.max(0.25, ...previewSystems.map((system) => system.duration))
  }
  elapsed = 0
  renderTransport()
}

function releasePreview(): void {
  for (const system of previewSystems) system.dispose()
  previewSystems = []
  if (currentGroup) scene.remove(currentGroup)
  currentGroup = undefined
}

function setupPreview(): void {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  scene = new THREE.Scene()
  scene.background = new THREE.Color('#0c1119')
  camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150)
  camera.position.set(8, 6, 10)
  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0, 1.1, 0)
  controls.minDistance = 2
  controls.maxDistance = 35
  scene.add(new THREE.HemisphereLight(0xc4ddff, 0x242130, 1.7))
  const key = new THREE.DirectionalLight(0xffe2b1, 2.2)
  key.position.set(-4, 8, 5)
  scene.add(key)
  grid = new THREE.GridHelper(16, 32, 0x46526a, 0x222c3a)
  grid.position.y = -0.025
  scene.add(grid)
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(8, 64),
    new THREE.MeshBasicMaterial({ color: 0x101722, transparent: true, opacity: 0.72 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.04
  scene.add(floor)
  batch = new BatchedRenderer()
  scene.add(batch)
  const resize = new ResizeObserver(() => {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer.setSize(rect.width, rect.height, false)
    camera.aspect = rect.width / rect.height
    camera.updateProjectionMatrix()
  })
  resize.observe(canvas)
  window.addEventListener(
    'beforeunload',
    () => {
      resize.disconnect()
      controls.dispose()
      renderer.dispose()
    },
    { once: true },
  )
}

function frame(now: number): void {
  if (!frameRequest) return
  const dt = Math.min((now - previousFrame) / 1000, 0.05)
  previousFrame = now
  if (playing && dt > 0) {
    batch.update(dt)
    elapsed += dt
    if (elapsed >= previewDuration) {
      if (previewSystems.some((system) => system.looping)) elapsed %= previewDuration
      else {
        elapsed = previewDuration
        playing = false
      }
    }
    renderTransport()
  }
  controls.update()
  renderer.render(scene, camera)
  frameRequest = window.requestAnimationFrame(frame)
}

function startAnimation(): void {
  if (!frameRequest) {
    previousFrame = performance.now()
    frameRequest = window.requestAnimationFrame(frame)
  }
}

function schedulePreview(): void {
  window.clearTimeout(previewTimer)
  previewTimer = window.setTimeout(() => {
    resetPreview()
    renderTransport()
  }, 120)
}

function markEdit(): void {
  syncEffect()
  markDirty()
  renderEffects()
  renderSystems()
  schedulePreview()
}

function setRange(
  system: ParticleSystem,
  key: 'life' | 'speed' | 'size' | 'rotation',
  index: 0 | 1,
  value: number,
): void {
  const property =
    key === 'life'
      ? 'startLife'
      : key === 'speed'
        ? 'startSpeed'
        : key === 'size'
          ? 'startSize'
          : 'startRotation'
  const bounds = intervalBounds(system[property], [0, 0])
  bounds[index] = key === 'rotation' ? (value * Math.PI) / 180 : value
  system[property] = new IntervalValue(bounds[0], bounds[1])
}

function writeBound(target: HTMLInputElement | HTMLSelectElement): void {
  const bind = target.dataset.bind
  const system = currentEmitter()?.system
  const effect = currentEffect()
  if (!bind || !system || !effect) return
  const value =
    target instanceof HTMLInputElement && target.type === 'checkbox'
      ? target.checked
      : target instanceof HTMLInputElement && target.type === 'color'
        ? fromHex(target.value)
        : target instanceof HTMLSelectElement &&
            (bind === 'additive' ||
              bind === 'looping' ||
              bind === 'worldSpace' ||
              bind === 'blendTiles')
          ? target.value === 'true'
          : target instanceof HTMLInputElement && target.type === 'number'
            ? Number(target.value)
            : target.value
  if (bind === 'effect.name') {
    const name = String(value).trim() || effect.id
    currentGroup!.name = name
    nativeRoot(effect.json).name = name
  } else if (bind.startsWith('effect.rotation.')) {
    const axis = bind.at(-1) as 'x' | 'y' | 'z'
    currentGroup!.rotation[axis] = (Number(value) * Math.PI) / 180
  } else if (bind === 'duration') system.duration = Number(value)
  else if (bind === 'looping') system.looping = Boolean(value)
  else if (bind === 'worldSpace') system.worldSpace = Boolean(value)
  else if (bind === 'prewarm') system.prewarm = Boolean(value)
  else if (bind === 'autoDestroy') system.autoDestroy = Boolean(value)
  else if (bind === 'rate') system.emissionOverTime = new ConstantValue(Number(value))
  else if (bind === 'distanceRate') system.emissionOverDistance = new ConstantValue(Number(value))
  else if (bind === 'life.0' || bind === 'life.1')
    setRange(system, 'life', Number(bind.at(-1)) as 0 | 1, Number(value))
  else if (bind === 'speed.0' || bind === 'speed.1')
    setRange(system, 'speed', Number(bind.at(-1)) as 0 | 1, Number(value))
  else if (bind === 'size.0' || bind === 'size.1')
    setRange(system, 'size', Number(bind.at(-1)) as 0 | 1, Number(value))
  else if (bind === 'rotation.0' || bind === 'rotation.1')
    setRange(system, 'rotation', Number(bind.at(-1)) as 0 | 1, Number(value))
  else if (bind === 'burst.count' || bind === 'burst.time') {
    const burst = system.emissionBursts[0]
    const count = burst ? intervalBounds(burst.count, [0, 0])[1] : 0
    const time = burst?.time ?? 0
    const nextCount = bind === 'burst.count' ? Number(value) : count
    const nextTime = bind === 'burst.time' ? Number(value) : time
    system.emissionBursts =
      nextCount > 0
        ? [
            {
              time: nextTime,
              count: new ConstantValue(nextCount),
              cycle: 1,
              interval: 0,
              probability: 1,
            },
          ]
        : []
  } else if (bind === 'shape.kind') {
    const shape = String(value)
    system.emitterShape =
      shape === 'cone'
        ? new ConeEmitter({ angle: Math.PI / 6, radius: 0.5 })
        : shape === 'sphere'
          ? new SphereEmitter({ radius: 1 })
          : shape === 'hemisphere'
            ? new HemisphereEmitter({ radius: 1 })
            : shape === 'circle'
              ? new CircleEmitter({ radius: 1 })
              : shape === 'donut'
                ? new DonutEmitter({ radius: 1, donutRadius: 0.2 })
                : shape === 'rectangle'
                  ? new RectangleEmitter({ width: 1, height: 1 })
                  : shape === 'grid'
                    ? new GridEmitter({ width: 1, height: 1, row: 2, column: 2 })
                    : new PointEmitter()
    renderInspector()
  } else if (bind === 'shape.angle' || bind === 'shape.arc') {
    const property = bind.slice('shape.'.length) as 'angle' | 'arc'
    if (property in system.emitterShape)
      (system.emitterShape as unknown as Record<string, unknown>)[property] =
        (Number(value) * Math.PI) / 180
  } else if (bind.startsWith('shape.')) {
    const key = bind.slice('shape.'.length)
    ;(system.emitterShape as unknown as Record<string, unknown>)[key] = Number(value)
  } else if (bind === 'gravity') {
    const force = system.behaviors.find((item) => item.type === 'ApplyForce') as
      ApplyForce | undefined
    if (Number(value) === 0) {
      if (force) system.behaviors.splice(system.behaviors.indexOf(force), 1)
    } else if (force) {
      force.direction.set(0, Math.sign(Number(value)), 0)
      force.magnitude = new ConstantValue(Math.abs(Number(value)))
    } else {
      system.behaviors.push(
        new ApplyForce(
          new QVector3(0, Math.sign(Number(value)), 0),
          new ConstantValue(Math.abs(Number(value))),
        ),
      )
    }
  } else if (bind === 'renderMode') system.renderMode = Number(value) as RenderMode
  else if (bind === 'additive' || bind === 'material') {
    const old = system.material as THREE.MeshBasicMaterial
    const textureName = bind === 'material' ? String(value) : materialOf(system).name
    const additive = bind === 'additive' ? Boolean(value) : old.blending === THREE.AdditiveBlending
    system.material = createMaterial(textureName, additive)
  } else if (bind === 'startColor' || bind === 'startAlpha') {
    const color = colorOf(system)
    const rgb = bind === 'startColor' ? (value as number[]) : color.slice(0, 3)
    const alpha = bind === 'startAlpha' ? Number(value) : color[3]
    system.startColor = new ConstantColor(new QVector4(rgb[0]!, rgb[1]!, rgb[2]!, alpha))
  } else if (bind === 'uTileCount') system.uTileCount = Number(value)
  else if (bind === 'vTileCount') system.vTileCount = Number(value)
  else if (bind === 'startTileIndex') system.startTileIndex = new ConstantValue(Number(value))
  else if (bind === 'blendTiles') system.blendTiles = Boolean(value)
  else if (bind === 'frame.start' || bind === 'frame.end') {
    const [start, end] = frameRange(system) ?? [0, system.uTileCount * system.vTileCount]
    setFrameRange(
      system,
      bind === 'frame.start' ? Number(value) : start,
      bind === 'frame.end' ? Number(value) : end,
    )
  }
  markEdit()
}

function createMaterial(name: string, additive = true): THREE.MeshBasicMaterial {
  const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
  map.name = name
  map.colorSpace = THREE.SRGBColorSpace
  map.needsUpdate = true
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    name,
  })
}

function newNativeSystem(): ParticleSystem {
  return new ParticleSystem({
    duration: 1,
    looping: false,
    autoDestroy: false,
    shape: new ConeEmitter({ angle: Math.PI / 6, radius: 0.1 }),
    startLife: new IntervalValue(0.4, 0.8),
    startSpeed: new IntervalValue(1, 3),
    startSize: new IntervalValue(0.25, 0.6),
    startColor: new ConstantColor(new QVector4(1, 0.6, 0.2, 1)),
    emissionOverTime: new ConstantValue(20),
    emissionBursts: [],
    material: createMaterial([...textures][0] ?? 'circle'),
    behaviors: [
      new SizeOverLife(
        linearCurve([
          [0, 0.2],
          [0.4, 1],
          [1, 0],
        ]),
      ),
    ],
  })
}

function slug(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'new-effect'
  )
}

function openNameModal(title: string, initial: string, callback: (name: string) => void): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.innerHTML = `<form class="modal"><h2>${esc(title)}</h2><p>Effects are stored as Three.js Object3D JSON with Quarks ParticleEmitter data.</p><input name="name" value="${esc(initial)}" maxlength="80" autocomplete="off" aria-label="Effect name"><div class="modal-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Create effect</button></div></form>`
  document.body.append(backdrop)
  const form = backdrop.querySelector('form')!
  const input = form.querySelector('input')!
  input.focus()
  input.select()
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    callback(input.value.trim())
    backdrop.remove()
  })
  form.querySelector('[data-cancel]')!.addEventListener('click', () => backdrop.remove())
}

async function saveCurrent(): Promise<void> {
  const effect = currentEffect()
  if (!effect || !currentGroup) return
  try {
    syncEffect()
    effect.json = parseQuarksDocument(serializeGroup(currentGroup))
    await request('/particles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: effect.id, json: effect.json }),
    })
    savedIds.add(effect.id)
    setSaved()
    renderEffects()
    renderInspector()
    flash(`Saved native Quarks JSON: ${effect.id}.json`)
  } catch (error) {
    flash(error instanceof Error ? error.message : 'Could not save Quarks document', true)
  }
}

function selectEffect(id: string): void {
  if (id === currentId) return
  if (dirty) {
    if (!window.confirm('Discard unsaved changes and switch effect?')) return
    const saved = bundledById.get(currentId)
    if (saved)
      effects = effects.map((effect) => (effect.id === currentId ? structuredClone(saved) : effect))
    else effects = effects.filter((effect) => effect.id !== currentId)
  }
  if (!effects.some((effect) => effect.id === id)) return
  releasePreview()
  currentId = id
  systemIndex = 0
  undoStack.length = 0
  redoStack.length = 0
  setSaved()
  updateHistoryButtons()
  renderEffects()
  renderSystems()
  renderInspector()
  resetPreview()
}

function addNewEffect(name: string, source?: EffectFile): void {
  const id = slug(name)
  if (effects.some((effect) => effect.id === id)) {
    flash(`An effect named "${id}" already exists.`, true)
    return
  }
  releasePreview()
  const group = new THREE.Group()
  group.name = name
  const json = source
    ? structuredClone(source.json)
    : (() => {
        const emitter = newNativeSystem().emitter
        emitter.name = 'Particle System'
        group.add(emitter)
        return serializeGroup(group)
      })()
  nativeRoot(json).name = name
  effects.push({ id, json })
  currentId = id
  systemIndex = 0
  undoStack.length = 0
  redoStack.length = 0
  markDirty()
  renderEffects()
  renderSystems()
  renderInspector()
  resetPreview()
}

function drawTransport(): void {
  const fraction = Math.max(0, Math.min(1, elapsed / previewDuration))
  $('[data-progress]').setAttribute('style', `width:${fraction * 100}%`)
  $('[data-knob]').setAttribute('style', `left:${fraction * 100}%`)
  $('[data-time]').textContent = elapsed.toFixed(2)
  $('[data-duration]').textContent = `${previewDuration.toFixed(2)} s`
  $('[data-end-tick]').textContent = `${previewDuration.toFixed(1)}s`
  $<HTMLButtonElement>('[data-play]').textContent = playing ? 'Pause' : 'Play'
  $<HTMLInputElement>('[data-timeline]').value = String(Math.round(fraction * 1000))
}

function importFile(file: File): void {
  void file
    .text()
    .then((text) => {
      const json = parseQuarksDocument(JSON.parse(text))
      const name = String(nativeRoot(json).name || file.name.replace(/\.json$/i, ''))
      const id = slug(name)
      const imported = { id, json }
      if (effects.some((effect) => effect.id === id)) {
        if (!window.confirm(`Replace the current "${id}" document with this file?`)) return
        releasePreview()
        effects = effects.map((effect) => (effect.id === id ? imported : effect))
        currentId = id
        systemIndex = 0
        markDirty()
        renderEffects()
        renderSystems()
        renderInspector()
        resetPreview()
      } else addNewEffect(name, imported)
    })
    .catch((error: unknown) =>
      flash(error instanceof Error ? error.message : 'Invalid Quarks JSON', true),
    )
}

function exportCurrent(): void {
  const effect = currentEffect()
  if (!effect || !currentGroup) return
  const json = serializeGroup(currentGroup)
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${effect.id}.json`
  link.click()
  URL.revokeObjectURL(url)
}

root.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-action], [data-effect], [data-system]',
  )
  if (!target) return
  const action = target.dataset.action
  if (action === 'undo') {
    travelHistory(undoStack, redoStack)
    return
  }
  if (action === 'redo') {
    travelHistory(redoStack, undoStack)
    return
  }
  if (target.dataset.effect) {
    selectEffect(target.dataset.effect)
    return
  }
  if (target.dataset.system !== undefined) {
    systemIndex = Number(target.dataset.system)
    renderSystems()
    renderInspector()
    return
  }
  if (action === 'save') void saveCurrent()
  else if (action === 'import') $<HTMLInputElement>('[data-file-input]').click()
  else if (action === 'export') exportCurrent()
  else if (action === 'new')
    openNameModal('Create Quarks effect', 'New Effect', (name) => name && addNewEffect(name))
  else if (action === 'duplicate') {
    const effect = currentEffect()
    if (effect)
      openNameModal(
        'Duplicate effect',
        `${displayName(effect)} Copy`,
        (name) => name && addNewEffect(name, effect),
      )
  } else if (action === 'add-system' || action === 'duplicate-system') {
    const group = currentGroup
    if (!group) return
    recordHistory()
    const emitter =
      action === 'add-system'
        ? newNativeSystem().emitter
        : (currentEmitter()?.clone() as EmitterObject | undefined)
    if (emitter) {
      emitter.name = 'Particle System'
      group.add(emitter)
      systemIndex = emitters(group).length - 1
      syncEffect()
      markDirty()
      renderSystems()
      renderInspector()
      resetPreview()
    }
  } else if (action === 'remove-system') {
    const emitter = currentEmitter()
    if (!emitter || emitters().length <= 1) return
    recordHistory()
    emitter.system.dispose()
    emitter.parent?.remove(emitter)
    systemIndex = Math.max(0, systemIndex - 1)
    syncEffect()
    markDirty()
    renderSystems()
    renderInspector()
    resetPreview()
  } else if (action === 'move-system-up' || action === 'move-system-down') {
    const emitter = currentEmitter()
    const parent = emitter?.parent
    if (!emitter || !parent) return
    const index = parent.children.indexOf(emitter)
    const next = index + (action === 'move-system-up' ? -1 : 1)
    if (next < 0 || next >= parent.children.length) return
    recordHistory()
    parent.children.splice(index, 1)
    parent.children.splice(next, 0, emitter)
    systemIndex = emitters().indexOf(emitter)
    syncEffect()
    markDirty()
    renderSystems()
    renderInspector()
  } else if (action === 'play') {
    if (elapsed >= previewDuration) resetPreview()
    playing = !playing
    drawTransport()
  } else if (action === 'restart') {
    resetPreview()
    playing = true
    drawTransport()
  } else if (action === 'step') {
    playing = false
    batch.update(1 / 30)
    elapsed = Math.min(previewDuration, elapsed + 1 / 30)
    drawTransport()
  } else if (action === 'frame') {
    controls.target.set(0, 1, 0)
    camera.position.set(8, 6, 10)
    controls.update()
  } else if (action === 'grid') {
    showGrid = !showGrid
    grid.visible = showGrid
  } else if (action === 'enable-curve') {
    const system = currentEmitter()?.system
    if (system) {
      recordHistory()
      setSizeCurve(system, [
        [0, 0.2],
        [0.4, 1],
        [1, 0],
      ])
      markEdit()
      renderInspector()
    }
  } else if (action === 'add-curve-key' || action === 'remove-curve-key') {
    const system = currentEmitter()?.system
    const points = system && curveFromSystem(system)
    if (!system || !points) return
    recordHistory()
    if (action === 'add-curve-key') {
      points.push([0.5, 0.8])
      points.sort((a, b) => a[0] - b[0])
    } else if (points.length > 2) points.splice(points.length - 2, 1)
    setSizeCurve(system, points)
    markEdit()
    renderInspector()
  } else if (action === 'enable-color') {
    const system = currentEmitter()?.system
    if (!system) return
    recordHistory()
    const color = colorOf(system)
    setColorGradient(
      system,
      [
        [0, color[0], color[1], color[2]],
        [1, color[0], color[1], color[2]],
      ],
      [
        [0, color[3]],
        [1, 0],
      ],
    )
    markEdit()
    renderInspector()
  } else if (action === 'enable-frame') {
    const system = currentEmitter()?.system
    if (!system) return
    recordHistory()
    setFrameRange(system, 0, system.uTileCount * system.vTileCount)
    markEdit()
    renderInspector()
  } else if (action === 'apply-json') {
    const effect = currentEffect()
    const input = $<HTMLTextAreaElement>('[data-native-json]')
    if (!effect) return
    try {
      const json = parseQuarksDocument(JSON.parse(input.value))
      recordHistory()
      releasePreview()
      effect.json = json
      systemIndex = Math.min(systemIndex, emitterNodes(nativeRoot(json)).length - 1)
      markDirty()
      renderEffects()
      renderSystems()
      renderInspector()
      resetPreview()
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Invalid Quarks JSON', true)
    }
  } else if (
    action === 'add-color' ||
    action === 'remove-color' ||
    action === 'add-alpha' ||
    action === 'remove-alpha'
  ) {
    const system = currentEmitter()?.system
    const stops = system && colorStops(system)
    if (!system || !stops) return
    recordHistory()
    if (action === 'add-color') stops.colors.push([0.5, 1, 1, 1])
    else if (action === 'remove-color' && stops.colors.length > 2)
      stops.colors.splice(Number(target.dataset.index), 1)
    else if (action === 'add-alpha') stops.alphas.push([0.5, 1])
    else if (stops.alphas.length > 2) stops.alphas.splice(Number(target.dataset.index), 1)
    stops.colors.sort((a, b) => a[0] - b[0])
    stops.alphas.sort((a, b) => a[0] - b[0])
    setColorGradient(system, stops.colors, stops.alphas)
    markEdit()
    renderInspector()
  } else if (action === 'delete-effect') {
    const effect = currentEffect()
    if (!effect || isBuiltIn(effect.id) || !window.confirm(`Delete "${displayName(effect)}"?`))
      return
    releasePreview()
    effects = effects.filter((item) => item.id !== effect.id)
    if (savedIds.has(effect.id))
      void request(`/particles?id=${encodeURIComponent(effect.id)}`, { method: 'DELETE' }).catch(
        (error: unknown) => flash(error instanceof Error ? error.message : 'Delete failed', true),
      )
    savedIds.delete(effect.id)
    currentId = effects[0]?.id ?? ''
    systemIndex = 0
    setSaved()
    renderEffects()
    renderSystems()
    renderInspector()
    resetPreview()
  } else if (action === 'reset-effect') {
    const effect = currentEffect()
    const preset = effect && bundledById.get(effect.id)
    if (!effect || !preset) return
    void request(`/particles?id=${encodeURIComponent(effect.id)}`, { method: 'DELETE' })
      .then(() => {
        releasePreview()
        effects = effects.map((item) => (item.id === effect.id ? structuredClone(preset) : item))
        savedIds.delete(effect.id)
        setSaved()
        renderEffects()
        renderSystems()
        renderInspector()
        resetPreview()
        flash('Quarks preset restored')
      })
      .catch((error: unknown) =>
        flash(error instanceof Error ? error.message : 'Reset failed', true),
      )
  }
})

function editCurvePointer(event: PointerEvent, svg: SVGSVGElement): void {
  const point = (event.target as HTMLElement).closest<SVGCircleElement>('[data-curve-index]')
  const system = currentEmitter()?.system
  const points = system && curveFromSystem(system)
  if (!point || !system || !points) return
  event.preventDefault()
  recordHistory()
  svg.setPointerCapture(event.pointerId)
  const index = Number(point.dataset.curveIndex)
  const move = (pointer: PointerEvent) => {
    const rect = svg.getBoundingClientRect()
    const time = Math.max(0, Math.min(1, (pointer.clientX - rect.left) / rect.width))
    const value = Math.max(0, Math.min(2, 2 * (1 - (pointer.clientY - rect.top) / rect.height)))
    const next = curveFromSystem(system)
    if (!next?.[index]) return
    next[index]![0] =
      index === 0
        ? 0
        : index === next.length - 1
          ? 1
          : Math.max(next[index - 1]![0] + 0.015, Math.min(next[index + 1]![0] - 0.015, time))
    next[index]![1] = value
    setSizeCurve(system, next)
    drawCurve(svg, next)
    markEdit()
  }
  const end = () => {
    svg.removeEventListener('pointermove', move)
    svg.removeEventListener('pointerup', end)
    svg.removeEventListener('pointercancel', end)
  }
  svg.addEventListener('pointermove', move)
  svg.addEventListener('pointerup', end)
  svg.addEventListener('pointercancel', end)
}

root.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    if (target.dataset.bind) writeBound(target)
    else if (target instanceof HTMLInputElement && target.dataset.colorStop !== undefined) {
      const system = currentEmitter()?.system
      const stops = system && colorStops(system)
      const stop = stops?.colors[Number(target.dataset.colorStop)]
      if (!system || !stops || !stop) return
      if (target.dataset.colorPart === 'time') stop[0] = Number(target.value)
      else stop.splice(1, 3, ...fromHex(target.value))
      setColorGradient(system, stops.colors, stops.alphas)
      markEdit()
    } else if (target instanceof HTMLInputElement && target.dataset.alphaStop !== undefined) {
      const system = currentEmitter()?.system
      const stops = system && colorStops(system)
      const stop = stops?.alphas[Number(target.dataset.alphaStop)]
      if (!system || !stops || !stop) return
      if (target.dataset.alphaPart === 'time') stop[0] = Number(target.value)
      else stop[1] = Number(target.value)
      setColorGradient(system, stops.colors, stops.alphas)
      markEdit()
    } else if (target.matches('[data-timeline]')) {
      playing = false
      const next = (Number(target.value) / 1000) * previewDuration
      resetPreview()
      for (let i = 0; i < Math.ceil(next * 60); i++) batch.update(Math.min(1 / 60, next - i / 60))
      elapsed = next
      drawTransport()
    } else if (target.matches('[data-search]')) renderEffects()
  }
})

root.addEventListener('change', (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.dataset.bind) renderInspector()
})
root.addEventListener('focusin', (event) => {
  const target = event.target as HTMLElement
  if (
    target.dataset.bind ||
    target.dataset.colorStop !== undefined ||
    target.dataset.alphaStop !== undefined
  )
    recordHistory()
})
root.addEventListener('pointerdown', (event) => {
  const target = event.target as HTMLElement
  if (target.closest('[data-curve-index]')) {
    const svg = target.closest<SVGSVGElement>('[data-curve]')
    if (svg) editCurvePointer(event as PointerEvent, svg)
  }
})
$<HTMLInputElement>('[data-file-input]').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) importFile(file)
})

document.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement
  const key = event.key.toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 's') {
    event.preventDefault()
    void saveCurrent()
  } else if ((event.metaKey || event.ctrlKey) && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) travelHistory(redoStack, undoStack)
    else travelHistory(undoStack, redoStack)
  } else if ((event.metaKey || event.ctrlKey) && key === 'y') {
    event.preventDefault()
    travelHistory(redoStack, undoStack)
  } else if (event.code === 'Space' && !typing) {
    event.preventDefault()
    $<HTMLButtonElement>('[data-action="play"]').click()
  } else if (key === 'r' && !typing) {
    resetPreview()
    playing = true
  }
})

async function initialize(): Promise<void> {
  try {
    const [stored, textureResponse] = await Promise.all([
      request<{ effects: EffectFile[] }>('/particles'),
      request<{ textures: string[] }>('/particle-textures'),
    ])
    for (const texture of textureResponse.textures) textures.add(texture)
    for (const saved of stored.effects) {
      const json = parseQuarksDocument(saved.json)
      const index = effects.findIndex((effect) => effect.id === saved.id)
      if (index >= 0) effects[index] = { id: saved.id, json }
      else effects.push({ id: saved.id, json })
      savedIds.add(saved.id)
    }
  } catch (error) {
    flash(error instanceof Error ? error.message : 'Could not load native Quarks documents', true)
  }
  setupPreview()
  renderEffects()
  renderSystems()
  renderInspector()
  resetPreview()
  startAnimation()
}

window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault()
    event.returnValue = ''
  }
})
void initialize()
