import { vi, describe, it, expect } from 'vitest'
import * as THREE from 'three'
import type { RenderSegment, RenderSnake, RenderState } from '@/render/state'

// The viewer draws through canvas textures, so the module needs a DOM stub
// before it loads. Nothing renders, but the scene graph is the real one.
vi.hoisted(() => {
  const context = {
    translate() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    fillRect() {},
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    createRadialGradient: () => ({ addColorStop() {} }),
  }
  ;(globalThis as { document?: unknown }).document = {
    createElement: (tag: string) =>
      tag === 'canvas' ? { width: 0, height: 0, getContext: () => context } : {},
    createElementNS: () => ({
      addEventListener() {},
      removeEventListener() {},
      crossOrigin: '',
      src: '',
    }),
  }
})

const { createSnakeViewer } = await import('@/render/snake-view')

function snake(alive: boolean, parts: number, x: number): RenderSnake {
  const segments: RenderSegment[] = Array.from({ length: parts }, (_, index) => ({
    partId: index === 0 ? 'claw01' : 'normal',
    slot: index === 0 ? 'head' : 'body',
    dead: false,
    x: x + index * 1.2,
    z: 0,
    angle: 0,
    hurtUntil: 0,
    cooldown: 0,
  }))
  return { id: 'you', name: 'You', control: 'human', slot: 0, alive, score: 0, segments }
}

function state(target: RenderSnake): RenderState {
  return {
    time: 0,
    duration: 90,
    ended: false,
    snakes: [target],
    projectiles: [],
    areas: [],
    pickups: [],
  }
}

/** Bones are the only sphere in the scene: the parts stay placeholders here. */
function bones(scene: THREE.Scene): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  scene.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || node.geometry.type !== 'SphereGeometry') {
      return
    }
    let visible = node.visible
    for (let parent = node.parent; parent; parent = parent.parent) {
      visible &&= parent.visible
    }
    if (visible) {
      found.push(node)
    }
  })
  return found
}

function run(
  viewer: { sync(state: RenderState, dt?: number): void },
  target: RenderSnake,
  frames = 40,
) {
  for (let frame = 0; frame < frames; frame += 1) {
    viewer.sync(state(target), 0.05)
  }
}

describe('snake remains', () => {
  it('leaves no bones of a longer previous life after a respawn', () => {
    const scene = new THREE.Scene()
    const viewer = createSnakeViewer(scene)

    run(viewer, snake(true, 6, 0))
    run(viewer, snake(false, 0, 0))
    viewer.sync(state(snake(true, 4, 100)), 0.05)
    expect(bones(scene)).toHaveLength(0)

    // Long enough for the remains to shrink into bones, short enough to see them.
    run(viewer, snake(false, 0, 100), 12)

    const remains = bones(scene)
    expect(remains).toHaveLength(4)
    for (const bone of remains) {
      expect(bone.position.x).toBeGreaterThan(99)
    }
  })
})
