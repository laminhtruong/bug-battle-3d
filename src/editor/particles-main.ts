import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BatchedRenderer } from 'three.quarks'
import type { ParticleSystem } from 'three.quarks'
import { asset } from '@/core/asset'
import {
  particleEffectSchema,
  type ParticleEffect,
  type ParticleSystemSpec,
} from '@/content/particles'
import { createParticleSystem, PARTICLE_PRESETS } from '@/render/particles'
import './particles.css'

if (import.meta.hot) import.meta.hot.accept('@/render/particles', () => {})

const root = document.querySelector<HTMLElement>('#particle-editor')
if (!root) throw new Error('missing #particle-editor')

root.innerHTML = `
  <div class="studio">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">\u{2733}</div><div><div class="brand-title">VFX STUDIO</div><div class="brand-subtitle">Bug Battle \u{b7} Particle Authoring</div></div></div>
      <div class="top-actions"><button class="btn ghost" type="button" data-action="undo" title="Undo (Ctrl+Z)" disabled>Undo</button><button class="btn ghost" type="button" data-action="redo" title="Redo (Ctrl+Shift+Z)" disabled>Redo</button><span class="save-state" data-save-state>All changes saved</span><a class="top-link" href="/editor.html">Part editor \u{2197}</a><button class="btn primary" type="button" data-action="save">Save effect&nbsp; <span>Ctrl+S</span></button></div>
    </header>
    <main class="workspace">
      <aside class="left-panel">
        <section class="panel-block">
          <div class="section-title"><span>Effects library</span><span class="count" data-effect-count>00</span></div>
          <input class="search" type="search" placeholder="Search effects\u{2026}" aria-label="Search effects" data-search>
          <div class="effect-list" data-effect-list></div>
          <div class="system-actions"><button class="btn small" type="button" data-action="new">\u{ff0b} New effect</button><button class="btn small" type="button" data-action="duplicate" title="Duplicate selected effect">\u{29c9}</button></div>
        </section>
        <section class="panel-block">
          <div class="section-title"><span>Hierarchy</span><span class="count" data-system-count>00</span></div>
          <div data-system-list></div>
          <div class="system-actions"><button class="btn small" type="button" data-action="add-system">\u{ff0b} Add</button><button class="btn small" type="button" data-action="duplicate-system" title="Duplicate selected system">\u{29c9}</button><button class="btn small" type="button" data-action="move-system-up" title="Move system up">\u{2191}</button><button class="btn small" type="button" data-action="move-system-down" title="Move system down">\u{2193}</button><button class="btn small danger" type="button" data-action="remove-system" title="Remove selected system">\u{2212}</button></div>
        </section>
        <section class="panel-block"><div class="section-title"><span>Shortcuts</span></div><div class="hint">Space \u{b7} Play / pause<br>Ctrl+Z / Ctrl+Shift+Z \u{b7} Undo / redo<br>Ctrl+S \u{b7} Save effect<br>Ctrl+D \u{b7} Duplicate system<br>Drag \u{b7} Orbit camera&nbsp; \u{b7} &nbsp;Scroll \u{b7} Zoom</div></section>
      </aside>
      <section class="stage">
        <div class="viewport">
          <canvas id="vfx-canvas" aria-label="Particle effect preview"></canvas>
          <div class="viewport-label"><strong>Scene view</strong><span data-viewport-subtitle>Perspective \u{b7} Studio lighting</span></div>
          <div class="view-badge">REAL-TIME PREVIEW</div>
          <div class="viewport-actions"><button class="btn" type="button" data-action="frame">\u{2316} Frame</button><button class="btn" type="button" data-action="grid">\u{25a6} Grid</button></div>
        </div>
        <div class="timeline">
          <div class="transport"><button class="btn" type="button" data-action="restart" title="Restart (R)">\u{21ba}</button><button class="btn primary" type="button" data-action="play" title="Play / pause (Space)" data-play>\u{25b6}</button><button class="btn" type="button" data-action="step" title="Step frame">\u{25b8}\u{2502}</button><div class="time-readout"><span data-time>0.00</span> <span>/</span> <span data-duration>0.00 s</span></div></div>
          <div class="timeline-track"><div class="timeline-progress" data-progress></div><div class="timeline-knob" data-knob></div><div class="timeline-ticks"><span>0s</span><span>25%</span><span>50%</span><span>75%</span><span data-end-tick>1s</span></div><input class="timeline-input" type="range" min="0" max="1000" value="0" aria-label="Preview timeline" data-timeline></div>
        </div>
      </section>
      <aside class="right-panel" data-inspector></aside>
    </main>
  </div>
  <div class="toast" hidden></div>
`

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
let effects = Object.values(PARTICLE_PRESETS).map((effect) => structuredClone(effect))
const savedIds = new Set<string>()
const savedEffects = new Map(effects.map((effect) => [effect.id, structuredClone(effect)]))
let currentId = effects[0]?.id ?? ''
let systemIndex = 0
let dirty = false
let playing = true
let showGrid = true
let elapsed = 0
let previousFrame = 0
let frameRequest = 0
let toastTimer = 0
let previewDuration = 1
let previewSystems: ParticleSystem[] = []
let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let batch: BatchedRenderer
let grid: THREE.GridHelper
let previewTimer = 0
const undoStack: ParticleEffect[] = []
const redoStack: ParticleEffect[] = []

const currentEffect = (): ParticleEffect | undefined =>
  effects.find((effect) => effect.id === currentId)
const currentSystem = (): ParticleSystemSpec | undefined => currentEffect()?.systems[systemIndex]
const esc = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const n = (value: number, digits = 2): string =>
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

function recordHistory(): void {
  const effect = currentEffect()
  if (!effect) return
  undoStack.push(structuredClone(effect))
  if (undoStack.length > 100) undoStack.shift()
  redoStack.length = 0
  updateHistoryButtons()
}

function travelHistory(from: ParticleEffect[], to: ParticleEffect[]): void {
  const effect = currentEffect()
  const snapshot = from.pop()
  if (!effect || !snapshot) return
  to.push(structuredClone(effect))
  effects = effects.map((item) => (item.id === currentId ? snapshot : item))
  systemIndex = Math.min(systemIndex, snapshot.systems.length - 1)
  markDirty()
  renderEffects()
  renderSystems()
  renderInspector()
  resetSystems()
  updateHistoryButtons()
}

function isBuiltIn(id: string): boolean {
  return Object.hasOwn(PARTICLE_PRESETS, id)
}

function renderEffects(): void {
  const query = $<HTMLInputElement>('[data-search]').value.trim().toLowerCase()
  const visible = effects.filter((effect) =>
    `${effect.name} ${effect.id}`.toLowerCase().includes(query),
  )
  $('[data-effect-count]').textContent = String(effects.length).padStart(2, '0')
  effectList.innerHTML = visible.length
    ? visible
        .map(
          (effect) => `
    <button class="effect-item${effect.id === currentId ? ' active' : ''}" type="button" data-effect="${esc(effect.id)}">
      <span class="effect-icon">\u{2733}</span><span><span class="effect-name">${esc(effect.name)}</span><span class="effect-meta">${esc(effect.id)} \u{b7} ${effect.systems.length} system${effect.systems.length === 1 ? '' : 's'}</span></span>
      ${savedIds.has(effect.id) ? '<span class="saved-dot" title="Saved to project"></span>' : ''}
    </button>`,
        )
        .join('')
    : '<div class="empty-list">No matching effects</div>'
}

function renderSystems(): void {
  const effect = currentEffect()
  $('[data-system-count]').textContent = String(effect?.systems.length ?? 0).padStart(2, '0')
  if (!effect) {
    systemList.innerHTML = '<div class="empty-list">Create an effect to begin.</div>'
    return
  }
  systemList.innerHTML = `<div class="hierarchy-row"><span>\u{2304}</span><span class="tree-icon">\u{2733}</span><strong>${esc(effect.name)}</strong><span class="row-meta">FX</span></div>${effect.systems.map((spec, index) => `<button class="hierarchy-row${index === systemIndex ? ' active' : ''}" type="button" data-system="${index}"><span class="tree-indent"></span><span class="tree-icon">\u{25a7}</span><span>${esc(spec.material)}</span><span class="row-meta">${index + 1}</span></button>`).join('')}`
}

function colorStops(spec: ParticleSystemSpec): string {
  if (!spec.colorOverLife)
    return `<button class="btn small" type="button" data-action="enable-color">\u{ff0b} Add color over life</button>`
  const stops = spec.colorOverLife.colors
    .map(
      ([time, r, g, b], index) =>
        `<div class="color-stop"><input type="number" min="0" max="1" step="0.01" value="${n(time, 3)}" aria-label="Color stop time" data-color-stop="${index}" data-color-part="time"><input type="color" value="${asHex([r, g, b])}" aria-label="Color stop color" data-color-stop="${index}" data-color-part="color"><button class="btn small danger" type="button" data-action="remove-color" data-index="${index}" title="Remove color stop">\u{d7}</button></div>`,
    )
    .join('')
  const alpha = spec.colorOverLife.alphas
    .map(
      ([time, value], index) =>
        `<div class="color-stop"><input type="number" min="0" max="1" step="0.01" value="${n(time, 3)}" aria-label="Opacity stop time" data-alpha-stop="${index}" data-alpha-part="time"><input type="number" min="0" max="1" step="0.01" value="${n(value, 3)}" aria-label="Opacity" data-alpha-stop="${index}" data-alpha-part="value"><button class="btn small danger" type="button" data-action="remove-alpha" data-index="${index}" title="Remove opacity stop">\u{d7}</button></div>`,
    )
    .join('')
  return `<div class="asset-heading"><span>COLOR KEYS \u{b7} T / RGB</span><button class="btn small" type="button" data-action="add-color">\u{ff0b} Key</button></div>${stops}<div class="asset-heading" style="margin-top:12px"><span>ALPHA KEYS \u{b7} T / OPACITY</span><button class="btn small" type="button" data-action="add-alpha">\u{ff0b} Key</button></div>${alpha}`
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

function renderInspector(): void {
  const effect = currentEffect()
  const spec = currentSystem()
  if (!effect || !spec) {
    inspector.innerHTML = '<div class="empty-list">Select or create an effect.</div>'
    return
  }
  const shapeFields =
    spec.shape.kind === 'cone'
      ? `<label class="field"><span>CONE ANGLE \u{b7} DEG</span><input type="number" min="0" max="180" step="1" value="${n(spec.shape.angle)}" data-bind="shape.angle"></label><label class="field"><span>RADIUS</span><input type="number" min="0" step="0.05" value="${n(spec.shape.radius)}" data-bind="shape.radius"></label><label class="field full"><span>ARC \u{b7} DEG</span><input type="number" min="0" max="360" step="1" value="${n(spec.shape.arc ?? 360)}" data-bind="shape.arc"></label>`
      : spec.shape.kind === 'sphere' || spec.shape.kind === 'circle'
        ? `<label class="field"><span>RADIUS</span><input type="number" min="0" step="0.05" value="${n(spec.shape.radius)}" data-bind="shape.radius"></label>${spec.shape.kind === 'circle' ? `<label class="field"><span>THICKNESS</span><input type="number" min="0" max="1" step="0.05" value="${n(spec.shape.thickness ?? 1)}" data-bind="shape.thickness"></label>` : ''}`
        : '<p class="hint">Point emission spawns particles from the emitter origin.</p>'
  const burst = spec.bursts?.[0]
  const texture = spec.material
  const curve = spec.sizeOverLife
  const textureOptions = [...textures]
    .map(
      (name) =>
        `<option value="${esc(name)}" ${name === texture ? 'selected' : ''}>${esc(name)}</option>`,
    )
    .join('')
  inspector.innerHTML = `
    <header class="inspector-head"><div class="inspector-kicker">${isBuiltIn(effect.id) ? 'BUILT-IN PRESET' : 'CUSTOM EFFECT'} \u{b7} SYSTEM ${String(systemIndex + 1).padStart(2, '0')}</div><input class="inspector-title" value="${esc(effect.name)}" aria-label="Effect name" data-bind="effect.name"><div class="inspector-sub">${esc(effect.id)} <span>\u{b7}</span> ${effect.systems.length} layered system${effect.systems.length === 1 ? '' : 's'}</div></header>
    <section class="inspect-section"><h3>Emission</h3><div class="field-grid">
      <label class="field"><span>DURATION \u{b7} S</span><input type="number" min="0.01" step="0.05" value="${n(spec.duration)}" data-bind="system.duration"></label>
      <label class="field"><span>RATE \u{b7} /SEC</span><input type="number" min="0" step="1" value="${n(spec.rate ?? 0)}" data-bind="system.rate"></label>
      <label class="field"><span>LIFETIME \u{b7} MIN</span><input type="number" min="0.01" step="0.05" value="${n(spec.life[0])}" data-bind="system.life.0"></label>
      <label class="field"><span>LIFETIME \u{b7} MAX</span><input type="number" min="0.01" step="0.05" value="${n(spec.life[1])}" data-bind="system.life.1"></label>
      <label class="field"><span>BURST COUNT</span><input type="number" min="0" step="1" value="${burst?.count ?? 0}" data-bind="burst.count"></label>
      <label class="field"><span>BURST TIME \u{b7} S</span><input type="number" min="0" step="0.05" value="${n(burst?.time ?? 0)}" data-bind="burst.time"></label>
      <label class="check-field"><input type="checkbox" ${spec.loop ? 'checked' : ''} data-bind="system.loop"> Loop system</label>
      <label class="check-field"><input type="checkbox" ${spec.worldSpace === false ? '' : 'checked'} data-bind="system.worldSpace"> World space</label>
    </div><p class="hint">Rate emits continuously; burst adds an instantaneous pulse.</p></section>
    <section class="inspect-section"><h3>Motion & shape</h3><div class="field-grid">
      <label class="field"><span>SPEED \u{b7} MIN</span><input type="number" min="0" step="0.5" value="${n(spec.speed[0])}" data-bind="system.speed.0"></label>
      <label class="field"><span>SPEED \u{b7} MAX</span><input type="number" min="0" step="0.5" value="${n(spec.speed[1])}" data-bind="system.speed.1"></label>
      <label class="field"><span>SIZE \u{b7} MIN</span><input type="number" min="0.01" step="0.05" value="${n(spec.size[0])}" data-bind="system.size.0"></label>
      <label class="field"><span>SIZE \u{b7} MAX</span><input type="number" min="0.01" step="0.05" value="${n(spec.size[1])}" data-bind="system.size.1"></label>
      ${spec.rotation ? `<label class="field"><span>ROTATION \u{b7} MIN \u{b0}</span><input type="number" step="5" value="${n((spec.rotation[0] * 180) / Math.PI)}" data-bind="system.rotation.0"></label><label class="field"><span>ROTATION \u{b7} MAX \u{b0}</span><input type="number" step="5" value="${n((spec.rotation[1] * 180) / Math.PI)}" data-bind="system.rotation.1"></label>` : '<button class="btn small" type="button" data-action="enable-rotation">\u{ff0b} Random rotation</button>'}
      <label class="field"><span>GRAVITY</span><input type="number" step="0.5" value="${n(spec.gravity ?? 0)}" data-bind="system.gravity"></label>
      <label class="field"><span>EMITTER SHAPE</span><select data-bind="shape.kind">${(['point', 'cone', 'sphere', 'circle'] as const).map((kind) => `<option value="${kind}" ${spec.shape.kind === kind ? 'selected' : ''}>${kind}</option>`).join('')}</select></label>
      ${shapeFields}
    </div></section>
    <section class="inspect-section"><h3>Renderer & material</h3><div class="field-grid">
      <label class="field full"><span>SPRITE TEXTURE</span><select data-bind="system.material">${textureOptions}</select></label>
      <div class="field full"><img class="asset-preview" src="${asset(`textures/fx/${texture}.png`)}" alt="${esc(texture)} texture" data-texture-preview></div>
      <label class="field"><span>RENDER MODE</span><select data-bind="system.mode">${(['billboard', 'stretched', 'horizontal'] as const).map((mode) => `<option value="${mode}" ${spec.mode === mode ? 'selected' : ''}>${mode}</option>`).join('')}</select></label>
      <label class="field"><span>BLENDING</span><select data-bind="system.additive"><option value="true" ${spec.additive ? 'selected' : ''}>Additive</option><option value="false" ${spec.additive ? '' : 'selected'}>Alpha</option></select></label>
      <label class="field"><span>START COLOR</span><input type="color" value="${asHex(spec.startColor ?? [1, 1, 1, 1])}" data-bind="system.startColor"></label>
      <label class="field"><span>START ALPHA</span><input type="number" min="0" max="1" step="0.05" value="${n(spec.startColor?.[3] ?? 1)}" data-bind="system.startAlpha"></label>
    </div><p class="hint">Sprite-sheet settings stay in the selected texture preset; custom atlases can be added in the advanced pass.</p></section>
    <section class="inspect-section"><h3>Size over lifetime</h3>${curve ? '<div class="curve-box"><svg viewBox="0 0 100 100" preserveAspectRatio="none" data-curve></svg><span class="curve-label">0 \u{2192} LIFE \u{2192} 100%</span></div><div class="curve-tools"><span>Drag keys \u{b7} linear interpolation</span><div><button class="btn" type="button" data-action="add-curve-key">\u{ff0b} Key</button> <button class="btn" type="button" data-action="remove-curve-key">\u{2212} Key</button></div></div>' : '<button class="btn small" type="button" data-action="enable-curve">\u{ff0b} Add size curve</button>'}</section>
    <section class="inspect-section"><h3>Color over lifetime</h3>${colorStops(spec)}</section>
    <section class="inspect-section"><h3>Advanced</h3><div class="field-grid"><label class="field"><span>TILE X</span><input type="number" min="1" step="1" value="${spec.uv?.x ?? 1}" data-bind="uv.x"></label><label class="field"><span>TILE Y</span><input type="number" min="1" step="1" value="${spec.uv?.y ?? 1}" data-bind="uv.y"></label><label class="field"><span>FRAMES</span><input type="number" min="1" step="1" value="${spec.uv?.frames ?? 1}" data-bind="uv.frames"></label><label class="field"><span>START TILE</span><input type="number" min="0" step="1" value="${spec.uv?.start ?? 0}" data-bind="uv.start"></label><label class="field"><span>CYCLES</span><input type="number" min="0.1" step="0.1" value="${n(spec.uv?.cycles ?? 1)}" data-bind="uv.cycles"></label>${spec.mode === 'stretched' ? `<label class="field"><span>LENGTH FACTOR</span><input type="number" min="0" step="0.1" value="${n(spec.lengthFactor ?? 1)}" data-bind="system.lengthFactor"></label><label class="field"><span>SPEED FACTOR</span><input type="number" min="0" step="0.05" value="${n(spec.speedFactor ?? 0)}" data-bind="system.speedFactor"></label>` : ''}${spec.stretch ? `<label class="field"><span>GROUND STRETCH \u{b7} MIN</span><input type="number" min="0" step="0.5" value="${n(spec.stretch[0])}" data-bind="stretch.0"></label><label class="field"><span>GROUND STRETCH \u{b7} MAX</span><input type="number" min="0" step="0.5" value="${n(spec.stretch[1])}" data-bind="stretch.1"></label>` : '<button class="btn small" type="button" data-action="enable-stretch">\u{ff0b} Ground stretch behavior</button>'}</div><p class="hint">UV animation requires a sprite sheet. Ground stretch is for horizontal sprites.</p></section>
    <section class="inspect-section"><button class="btn danger small" type="button" data-action="delete-effect" ${isBuiltIn(effect.id) ? 'disabled title="Built-in presets cannot be deleted"' : ''}>Delete custom effect</button>${isBuiltIn(effect.id) && savedIds.has(effect.id) ? '<button class="btn small" type="button" data-action="reset-effect">Reset preset</button>' : ''}</section>`
  if (curve) drawCurve($<SVGSVGElement>('[data-curve]'), curve)
}

function drawTransport(): void {
  const fraction = Math.max(0, Math.min(1, elapsed / previewDuration))
  $('[data-progress]').setAttribute('style', `width:${fraction * 100}%`)
  $('[data-knob]').setAttribute('style', `left:${fraction * 100}%`)
  $('[data-time]').textContent = elapsed.toFixed(2)
  $('[data-duration]').textContent = `${previewDuration.toFixed(2)} s`
  $('[data-end-tick]').textContent = `${previewDuration.toFixed(1)}s`
  $<HTMLButtonElement>('[data-play]').textContent = playing ? '\u{2161}' : '\u{25b6}'
  $<HTMLInputElement>('[data-timeline]').value = String(Math.round(fraction * 1000))
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

function resetSystems(): void {
  for (const system of previewSystems) system.dispose()
  previewSystems = []
  scene.remove(batch)
  batch = new BatchedRenderer()
  scene.add(batch)
  const effect = currentEffect()
  previewDuration = Math.max(0.25, ...(effect?.systems.map((spec) => spec.duration) ?? [1]))
  effect?.systems.forEach((spec, index) => {
    const system = createParticleSystem(spec)
    if (effect.id === 'flame-head' || effect.id === 'flame-body')
      system.emitter.position.z = index === 2 ? 0.416 : 0
    system.emitter.position.y = 0.15
    scene.add(system.emitter)
    batch.addSystem(system)
    previewSystems.push(system)
  })
  elapsed = 0
  drawTransport()
}

function frame(now: number): void {
  if (!frameRequest) return
  const dt = Math.min((now - previousFrame) / 1000, 0.05)
  previousFrame = now
  if (playing && Number.isFinite(dt) && dt > 0) {
    batch.update(dt)
    elapsed += dt
    if (elapsed >= previewDuration) {
      if (currentEffect()?.systems.some((spec) => spec.loop)) elapsed %= previewDuration
      else {
        elapsed = previewDuration
        playing = false
      }
    }
    drawTransport()
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
    resetSystems()
    drawTransport()
  }, 120)
}

function writeBound(target: HTMLInputElement | HTMLSelectElement): void {
  const bind = target.dataset.bind
  if (!bind) return
  const effect = currentEffect()
  const spec = currentSystem()
  if (!effect || !spec) return
  let value: unknown
  if (target instanceof HTMLInputElement && target.type === 'checkbox') value = target.checked
  else if (target instanceof HTMLInputElement && target.type === 'color')
    value = fromHex(target.value)
  else if (target instanceof HTMLSelectElement && bind === 'system.additive')
    value = target.value === 'true'
  else if (target instanceof HTMLInputElement && target.type === 'number')
    value = Number(target.value)
  else value = target.value
  if (bind === 'effect.name') {
    effect.name = String(value).slice(0, 80)
    renderEffects()
    renderSystems()
  } else if (bind === 'shape.kind') {
    const kind = String(value) as ParticleSystemSpec['shape']['kind']
    spec.shape =
      kind === 'cone'
        ? { kind, angle: 20, radius: 0.5 }
        : kind === 'sphere'
          ? { kind, radius: 1 }
          : kind === 'circle'
            ? { kind, radius: 1, thickness: 1 }
            : { kind: 'point' }
    renderInspector()
  } else if (bind.startsWith('shape.')) {
    ;(spec.shape as unknown as Record<string, unknown>)[bind.slice(6)] = value
  } else if (bind.startsWith('system.')) {
    const key = bind.slice(7)
    const range = ['life', 'speed', 'size'].find((field) => key.startsWith(`${field}.`))
    if (range) {
      ;(spec[range as 'life' | 'speed' | 'size'] as number[])[Number(key.slice(range.length + 1))] =
        Number(value)
    } else if (key.startsWith('rotation.')) {
      spec.rotation ??= [0, 0]
      spec.rotation[Number(key.slice('rotation.'.length))] = (Number(value) * Math.PI) / 180
    } else if (key === 'startColor') {
      const rgba = spec.startColor ?? [1, 1, 1, 1]
      spec.startColor = [...(value as number[]), rgba[3]] as [number, number, number, number]
    } else if (key === 'startAlpha') {
      const rgba = spec.startColor ?? [1, 1, 1, 1]
      spec.startColor = [rgba[0], rgba[1], rgba[2], Number(value)]
    } else if (key === 'gravity' && Number(value) === 0) {
      delete spec.gravity
    } else {
      ;(spec as unknown as Record<string, unknown>)[key] = value
    }
  } else if (bind.startsWith('burst.')) {
    const key = bind.slice(6) as 'time' | 'count'
    if (!spec.bursts?.length) spec.bursts = [{ time: 0, count: 0 }]
    const burst = spec.bursts[0]!
    burst[key] = Number(value)
    if (!burst.count) spec.bursts = undefined
  } else if (bind.startsWith('uv.')) {
    const key = bind.slice(3)
    if (!spec.uv) spec.uv = { x: 1, y: 1, frames: 1, start: 0, cycles: 1 }
    ;(spec.uv as unknown as Record<string, unknown>)[key] = Number(value)
    if (
      spec.uv.x === 1 &&
      spec.uv.y === 1 &&
      spec.uv.frames === 1 &&
      spec.uv.start === 0 &&
      spec.uv.cycles === 1
    )
      spec.uv = undefined
  } else if (bind.startsWith('stretch.')) {
    spec.stretch ??= [4, 8]
    spec.stretch[Number(bind.slice('stretch.'.length))] = Number(value)
  }
  markDirty()
  schedulePreview()
}

function editColorStop(target: HTMLInputElement): void {
  const spec = currentSystem()
  const index = Number(target.dataset.colorStop)
  if (!spec?.colorOverLife || !Number.isInteger(index)) return
  const stop = spec.colorOverLife.colors[index]
  if (!stop) return
  if (target.dataset.colorPart === 'time') stop[0] = Number(target.value)
  else stop.splice(1, 3, ...fromHex(target.value))
  markDirty()
  schedulePreview()
}

function editAlphaStop(target: HTMLInputElement): void {
  const stops = currentSystem()?.colorOverLife?.alphas
  const stop = stops?.[Number(target.dataset.alphaStop)]
  if (!stop) return
  if (target.dataset.alphaPart === 'time') stop[0] = Number(target.value)
  else stop[1] = Number(target.value)
  markDirty()
  schedulePreview()
}

function beginCurveDrag(event: PointerEvent, svg: SVGSVGElement): void {
  const point = (event.target as HTMLElement).closest<SVGCircleElement>('[data-curve-index]')
  const points = currentSystem()?.sizeOverLife
  if (!point || !points) return
  event.preventDefault()
  const index = Number(point.dataset.curveIndex)
  svg.setPointerCapture(event.pointerId)
  const move = (pointer: PointerEvent) => {
    const rect = svg.getBoundingClientRect()
    const time = Math.max(0, Math.min(1, (pointer.clientX - rect.left) / rect.width))
    const value = Math.max(0, Math.min(2, 2 * (1 - (pointer.clientY - rect.top) / rect.height)))
    const current = currentSystem()?.sizeOverLife
    const key = current?.[index]
    if (!current || !key) return
    key[0] =
      index === 0
        ? 0
        : index === current.length - 1
          ? 1
          : Math.max(current[index - 1]![0] + 0.015, Math.min(current[index + 1]![0] - 0.015, time))
    key[1] = value
    drawCurve(svg, current)
    markDirty()
    schedulePreview()
  }
  const finish = () => {
    svg.removeEventListener('pointermove', move)
    svg.removeEventListener('pointerup', finish)
    svg.removeEventListener('pointercancel', finish)
  }
  svg.addEventListener('pointermove', move)
  svg.addEventListener('pointerup', finish)
  svg.addEventListener('pointercancel', finish)
}

function newSystem(): ParticleSystemSpec {
  return {
    duration: 1,
    life: [0.4, 0.8],
    speed: [1, 3],
    size: [0.25, 0.6],
    rate: 20,
    bursts: [{ time: 0, count: 12 }],
    shape: { kind: 'cone', angle: 25, radius: 0.12 },
    startColor: [1, 0.55, 0.15, 1],
    colorOverLife: {
      colors: [
        [0, 1, 0.8, 0.3],
        [1, 0.45, 0.06, 0.03],
      ],
      alphas: [
        [0, 0],
        [0.1, 1],
        [1, 0],
      ],
    },
    sizeOverLife: [
      [0, 0.2],
      [0.35, 1],
      [1, 0],
    ],
    material: textures.has('fire-soft-blank') ? 'fire-soft-blank' : ([...textures][0] ?? 'circle'),
    additive: true,
    mode: 'billboard',
  }
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
  backdrop.innerHTML = `<form class="modal"><h2>${esc(title)}</h2><p>Use a short name. The effect id is generated as a kebab-case filename.</p><input name="name" value="${esc(initial)}" maxlength="80" autocomplete="off" aria-label="Effect name"><div class="modal-actions"><button class="btn" type="button" data-cancel>Cancel</button><button class="btn primary" type="submit">Create effect</button></div></form>`
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
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) backdrop.remove()
  })
}

async function saveCurrent(): Promise<void> {
  const effect = currentEffect()
  if (!effect) return
  try {
    const candidate = structuredClone(effect)
    for (const spec of candidate.systems) {
      spec.sizeOverLife?.sort((a, b) => a[0] - b[0])
      spec.colorOverLife?.colors.sort((a, b) => a[0] - b[0])
      spec.colorOverLife?.alphas.sort((a, b) => a[0] - b[0])
    }
    const checked = particleEffectSchema.parse(candidate)
    await request('/particles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(checked),
    })
    savedIds.add(effect.id)
    savedEffects.set(effect.id, structuredClone(checked))
    setSaved()
    renderEffects()
    renderInspector()
    flash(`Saved \u{201c}${effect.name}\u{201d} \u{b7} available to projectile visuals`)
  } catch (error) {
    flash(error instanceof Error ? error.message : 'Could not save particle effect', true)
  }
}

function selectEffect(id: string): void {
  if (id === currentId) return
  if (dirty) {
    if (!window.confirm('Discard unsaved changes and switch effect?')) return
    const baseline = savedEffects.get(currentId)
    if (baseline)
      effects = effects.map((effect) =>
        effect.id === currentId ? structuredClone(baseline) : effect,
      )
    else effects = effects.filter((effect) => effect.id !== currentId)
  }
  if (!effects.some((effect) => effect.id === id)) return
  currentId = id
  systemIndex = 0
  undoStack.length = 0
  redoStack.length = 0
  setSaved()
  updateHistoryButtons()
  renderEffects()
  renderSystems()
  renderInspector()
  resetSystems()
}

function addNewEffect(name: string, source?: ParticleEffect): void {
  const id = slug(name)
  if (effects.some((effect) => effect.id === id)) {
    flash(`An effect named \u{201c}${id}\u{201d} already exists.`, true)
    return
  }
  const effect = source ? structuredClone(source) : { id, name, systems: [newSystem()] }
  effect.id = id
  effect.name = name
  effects.push(effect)
  currentId = id
  systemIndex = 0
  undoStack.length = 0
  redoStack.length = 0
  markDirty()
  renderEffects()
  renderSystems()
  renderInspector()
  resetSystems()
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
  else if (action === 'new')
    openNameModal('Create particle effect', 'New Effect', (name) => name && addNewEffect(name))
  else if (action === 'duplicate') {
    const effect = currentEffect()
    if (effect)
      openNameModal(
        'Duplicate effect',
        `${effect.name} Copy`,
        (name) => name && addNewEffect(name, effect),
      )
  } else if (action === 'add-system') {
    recordHistory()
    currentEffect()?.systems.push(newSystem())
    systemIndex = (currentEffect()?.systems.length ?? 1) - 1
    markDirty()
    renderSystems()
    renderInspector()
    resetSystems()
  } else if (action === 'duplicate-system') {
    const effect = currentEffect()
    const spec = currentSystem()
    if (effect && spec) {
      recordHistory()
      effect.systems.splice(systemIndex + 1, 0, structuredClone(spec))
      systemIndex++
      markDirty()
      renderSystems()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'move-system-up' || action === 'move-system-down') {
    const effect = currentEffect()
    const nextIndex = systemIndex + (action === 'move-system-up' ? -1 : 1)
    if (effect && nextIndex >= 0 && nextIndex < effect.systems.length) {
      recordHistory()
      ;[effect.systems[systemIndex], effect.systems[nextIndex]] = [
        effect.systems[nextIndex]!,
        effect.systems[systemIndex]!,
      ]
      systemIndex = nextIndex
      markDirty()
      renderSystems()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'remove-system') {
    const effect = currentEffect()
    if (effect && effect.systems.length > 1) {
      recordHistory()
      effect.systems.splice(systemIndex, 1)
      systemIndex = Math.min(systemIndex, effect.systems.length - 1)
      markDirty()
      renderSystems()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'play') {
    if (elapsed >= previewDuration) resetSystems()
    playing = !playing
    drawTransport()
  } else if (action === 'restart') {
    resetSystems()
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
  } else if (action === 'delete-effect') {
    const effect = currentEffect()
    if (
      effect &&
      !isBuiltIn(effect.id) &&
      window.confirm(`Delete \u{201c}${effect.name}\u{201d}?`)
    ) {
      const id = effect.id
      effects = effects.filter((item) => item.id !== id)
      if (savedIds.has(id))
        void request(`/particles?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(
          (error: unknown) => flash(error instanceof Error ? error.message : 'Delete failed', true),
        )
      savedIds.delete(id)
      savedEffects.delete(id)
      currentId = effects[0]?.id ?? ''
      systemIndex = 0
      setSaved()
      renderEffects()
      renderSystems()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'reset-effect') {
    const effect = currentEffect()
    const preset = effect && PARTICLE_PRESETS[effect.id]
    if (
      effect &&
      preset &&
      window.confirm(`Reset \u{201c}${effect.name}\u{201d} to its original preset?`)
    ) {
      void request(`/particles?id=${encodeURIComponent(effect.id)}`, { method: 'DELETE' })
        .then(() => {
          effects = effects.map((item) => (item.id === effect.id ? structuredClone(preset) : item))
          savedIds.delete(effect.id)
          savedEffects.set(effect.id, structuredClone(preset))
          setSaved()
          renderEffects()
          renderSystems()
          renderInspector()
          resetSystems()
          flash('Preset restored')
        })
        .catch((error: unknown) =>
          flash(error instanceof Error ? error.message : 'Reset failed', true),
        )
    }
  } else if (action === 'enable-curve') {
    const spec = currentSystem()
    if (spec) {
      recordHistory()
      spec.sizeOverLife = [
        [0, 0.2],
        [0.4, 1],
        [1, 0],
      ]
      markDirty()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'add-curve-key' || action === 'remove-curve-key') {
    const spec = currentSystem()
    if (spec?.sizeOverLife) {
      recordHistory()
      if (action === 'add-curve-key') {
        const time = 0.5
        spec.sizeOverLife.push([time, 0.8])
        spec.sizeOverLife.sort((a, b) => a[0] - b[0])
      } else if (spec.sizeOverLife.length > 2)
        spec.sizeOverLife.splice(spec.sizeOverLife.length - 2, 1)
      markDirty()
      renderInspector()
      schedulePreview()
    }
  } else if (action === 'enable-color') {
    const spec = currentSystem()
    if (spec) {
      recordHistory()
      const c = spec.startColor ?? [1, 1, 1, 1]
      spec.colorOverLife = {
        colors: [
          [0, c[0], c[1], c[2]],
          [1, c[0], c[1], c[2]],
        ],
        alphas: [
          [0, c[3]],
          [1, 0],
        ],
      }
      markDirty()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'enable-rotation') {
    const spec = currentSystem()
    if (spec) {
      recordHistory()
      spec.rotation = [0, Math.PI * 2]
      markDirty()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'enable-stretch') {
    const spec = currentSystem()
    if (spec) {
      recordHistory()
      spec.stretch = [4, 8]
      spec.mode = 'horizontal'
      markDirty()
      renderInspector()
      resetSystems()
    }
  } else if (action === 'add-color' || action === 'remove-color') {
    const stops = currentSystem()?.colorOverLife?.colors
    if (stops) {
      recordHistory()
      if (action === 'add-color') stops.push([0.5, 1, 1, 1])
      else if (stops.length > 2) stops.splice(Number(target.dataset.index), 1)
      stops.sort((a, b) => a[0] - b[0])
      markDirty()
      renderInspector()
      schedulePreview()
    }
  } else if (action === 'add-alpha' || action === 'remove-alpha') {
    const stops = currentSystem()?.colorOverLife?.alphas
    if (stops) {
      recordHistory()
      if (action === 'add-alpha') stops.push([0.5, 1])
      else if (stops.length > 2) stops.splice(Number(target.dataset.index), 1)
      stops.sort((a, b) => a[0] - b[0])
      markDirty()
      renderInspector()
      schedulePreview()
    }
  }
})

root.addEventListener('input', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
    if (target.dataset.bind) writeBound(target)
    else if (target instanceof HTMLInputElement && target.dataset.colorStop !== undefined)
      editColorStop(target)
    else if (target instanceof HTMLInputElement && target.dataset.alphaStop !== undefined)
      editAlphaStop(target)
    else if (target.matches('[data-timeline]')) {
      playing = false
      const next = (Number(target.value) / 1000) * previewDuration
      resetSystems()
      const steps = Math.ceil(next * 60)
      for (let i = 0; i < steps; i++) batch.update(Math.min(1 / 60, next - i / 60))
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
  ) {
    recordHistory()
  }
})
root.addEventListener('pointerdown', (event) => {
  if ((event.target as HTMLElement).closest('[data-curve-index]')) {
    const svg = (event.target as HTMLElement).closest<SVGSVGElement>('[data-curve]')
    if (svg) {
      recordHistory()
      beginCurveDrag(event as PointerEvent, svg)
    }
  }
})

document.addEventListener('keydown', (event) => {
  const target = event.target
  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveCurrent()
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) travelHistory(redoStack, undoStack)
    else travelHistory(undoStack, redoStack)
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    travelHistory(redoStack, undoStack)
  } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && !typing) {
    event.preventDefault()
    const spec = currentSystem()
    const effect = currentEffect()
    if (spec && effect) {
      recordHistory()
      effect.systems.splice(systemIndex + 1, 0, structuredClone(spec))
      systemIndex++
      markDirty()
      renderSystems()
      renderInspector()
      resetSystems()
    }
  } else if (event.code === 'Space' && !typing) {
    event.preventDefault()
    $<HTMLButtonElement>('[data-action="play"]').click()
  } else if (event.key.toLowerCase() === 'r' && !typing) {
    resetSystems()
    playing = true
  }
})

async function initialize(): Promise<void> {
  try {
    const [stored, textureResponse] = await Promise.all([
      request<{ effects: ParticleEffect[] }>('/particles'),
      request<{ textures: string[] }>('/particle-textures'),
    ])
    textures.clear()
    for (const texture of textureResponse.textures) textures.add(texture)
    for (const saved of stored.effects) {
      const parsed = particleEffectSchema.parse(saved)
      const index = effects.findIndex((effect) => effect.id === parsed.id)
      if (index >= 0) effects[index] = parsed
      else effects.push(parsed)
      savedIds.add(parsed.id)
      savedEffects.set(parsed.id, structuredClone(parsed))
    }
  } catch (error) {
    flash(error instanceof Error ? error.message : 'Could not load particle library', true)
  }
  setupPreview()
  renderEffects()
  renderSystems()
  renderInspector()
  resetSystems()
  startAnimation()
}

void initialize()

window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault()
    event.returnValue = ''
  }
})
