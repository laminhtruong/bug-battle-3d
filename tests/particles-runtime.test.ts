import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, Scene } from 'three'
import { BatchedRenderer, QuarksLoader } from 'three.quarks'
import type { ParticleSystem } from 'three.quarks'
import { createParticles } from '@/render/particles'

const bundled = import.meta.glob('../src/content/particles/*.json', {
  eager: true,
  import: 'default',
})
const parse = QuarksLoader.prototype.parse

beforeEach(() => {
  // Keep the real Quarks loader/simulation; only image loading needs a browser.
  vi.spyOn(QuarksLoader.prototype, 'parse').mockImplementation(function (this: QuarksLoader, json) {
    const document = structuredClone(json) as {
      images?: unknown[]
      textures?: unknown[]
      materials: { map?: string }[]
    }
    delete document.images
    delete document.textures
    for (const material of document.materials) delete material.map
    return parse.call(this, document)
  })
})

afterEach(() => vi.restoreAllMocks())

function systems(group: Group | Scene): ParticleSystem[] {
  const result: ParticleSystem[] = []
  group.traverse((node) => {
    if (node.type === 'ParticleEmitter' && 'system' in node)
      result.push(node.system as ParticleSystem)
  })
  return result
}

describe('Unity particle presets', () => {
  it.each([
    ['flame-head', 3],
    ['flame-body', 3],
    ['lightning-impact', 5],
    ['lightning-orb', 2],
    ['poison-impact', 4],
    ['poison-orb', 1],
    ['death-explosion', 3],
  ])('loads and simulates every layer of %s without invalid particles', (id, count) => {
    const source = bundled[`../src/content/particles/${id}.json`]
    const group = new QuarksLoader().parse(source) as Group
    const scene = new Scene()
    const batch = new BatchedRenderer()
    scene.add(group, batch)
    const all = systems(group)
    expect(all).toHaveLength(count)
    expect(all.map((system) => system.behaviors.map((behavior) => behavior.type)).flat()).toContain(
      'ColorOverLife',
    )
    for (const system of all) {
      system.autoDestroy = false
      batch.addSystem(system)
    }
    for (let frame = 0; frame < 240; frame++) {
      batch.update(1 / 60)
      for (const system of all) {
        for (let i = 0; i < system.particleNum; i++) {
          const particle = system.particles[i]!
          expect(
            [
              particle.position.x,
              particle.position.y,
              particle.position.z,
              particle.size.x,
              particle.size.y,
              particle.size.z,
              particle.color.x,
              particle.color.y,
              particle.color.z,
              particle.color.w,
              particle.uvTile,
            ].every(Number.isFinite),
          ).toBe(true)
          expect(Math.min(particle.size.x, particle.size.y, particle.size.z)).toBeGreaterThanOrEqual(0)
          expect(particle.uvTile).toBeGreaterThanOrEqual(0)
          expect(particle.uvTile).toBeLessThan(system.uTileCount * system.vTileCount)
        }
      }
    }
    for (const system of all) system.dispose()
  })

  it('uses Unity start colors, smoke opacity, fixed random atlas frames and speed limits', () => {
    const load = (id: string) =>
      systems(new QuarksLoader().parse(bundled[`../src/content/particles/${id}.json`]) as Group)
    const poison = load('poison-orb')[0]!
    expect(poison.startColor.toJSON()).toEqual({
      type: 'ConstantColor',
      color: { r: 0, g: 1, b: 0, a: 1 },
    })
    for (const id of ['flame-head', 'flame-body']) {
      const flames = load(id)
      expect(flames[0]!.startSpeed.toJSON()).toEqual({
        type: 'IntervalValue',
        a: id === 'flame-head' ? 60 : 22.5,
        b: id === 'flame-head' ? 80 : 30,
      })
      expect(flames[1]!.startColor.toJSON()).toMatchObject({ color: { a: 0.3137255 } })
      for (const system of flames) {
        expect(system.startTileIndex.toJSON()).toEqual({ type: 'IntervalValue', a: 0, b: 3.9996 })
        expect(system.behaviors.some((behavior) => behavior.type === 'FrameOverLife')).toBe(false)
        expect(system.behaviors.some((behavior) => behavior.type === 'LimitSpeedOverLife')).toBe(
          true,
        )
        system.dispose()
      }
    }
    const impact = load('poison-impact')
    expect(impact[2]!.startColor.toJSON().type).toBe('RandomColor')
    expect(impact[1]!.emitterShape.type).toBe('cone')
    expect(impact[0]!.renderMode).toBe(4)
    expect(impact[0]!.emitter.parent!.rotation.x).toBeCloseTo(-Math.PI / 2)
    const lightning = load('lightning-impact')
    expect(lightning[0]!.startColor.toJSON()).toMatchObject({
      color: { r: 1, g: 0.42745098, b: 1 },
    })
    expect(lightning[3]!.startColor.toJSON()).toMatchObject({ color: { r: 1, g: 0, b: 1 } })
    expect(lightning[0]!.behaviors.some((behavior) => behavior.type === 'LimitSpeedOverLife')).toBe(
      true,
    )
    for (const system of [poison, ...impact, ...lightning]) system.dispose()
  })
})

describe('game particle lifecycle', () => {
  it('removes finished flame, impact and death groups from their parents', () => {
    const scene = new Scene()
    const anchor = new Group()
    scene.add(anchor)
    const particles = createParticles(scene)
    particles.flame(anchor, 'head', 0, 0, 0, 0)
    particles.flame(anchor, 'body', 0, 0, 0, Math.PI / 2)
    particles.impact('lightning', 0, 0.5, 0)
    particles.impact('poison', 3, 0.5, 0)
    particles.explode(6, 0)
    expect(systems(scene)).toHaveLength(18)
    for (let frame = 0; frame < 420; frame++) particles.update(1 / 60)
    expect(systems(scene)).toHaveLength(0)
    expect(anchor.children).toHaveLength(0)
    expect(scene.children.filter((node) => node.type === 'Group')).toEqual([anchor])
  })

  it('moves orb glows with shots and disposes dropped shots', () => {
    const scene = new Scene()
    const particles = createParticles(scene)
    particles.shot('lightning', 'lightning', 1, 2, 3)
    particles.shot('poison', 'poison', 4, 2, 3)
    particles.update(1 / 60)
    const orbs = systems(scene)
    expect(orbs).toHaveLength(3)
    expect(orbs.every((system) => !system.worldSpace)).toBe(true)
    const glow = orbs[0]!
    const glowGroup = scene.children.find((node) => node.type === 'Group')!
    const x = glow.particles[0]!.position.x
    particles.shot('lightning', 'lightning', 10, 2, 3)
    particles.update(1 / 60)
    expect(systems(scene)).toHaveLength(3)
    expect(glow.particles[0]!.position.x).toBe(x)
    expect(glowGroup.position.x).toBe(10)
    particles.dropShot('lightning')
    particles.dropShot('poison')
    expect(systems(scene)).toHaveLength(0)
    expect(scene.children.filter((node) => node.type === 'Group')).toHaveLength(0)
  })
})
