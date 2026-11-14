import { describe, expect, it } from 'vitest'
import { Group, MeshBasicMaterial, Scene } from 'three'
import {
  BatchedRenderer,
  ConstantValue,
  FrameOverLife,
  ParticleSystem,
  PiecewiseBezier,
  SpriteParticle,
} from 'three.quarks'
import { quarksDocumentSchema } from '@/content/particles'
import lightningImpact from '@/content/particles/lightning-impact.json'
import { updateParticlePreview } from '@/editor/particles-preview'

const bundled = import.meta.glob('../src/content/particles/*.json', {
  eager: true,
  import: 'default',
})

interface NativeSystem {
  material: string
  shape: { type: string; thickness?: number }
  uTileCount: number
  vTileCount: number
  renderMode: number
  rendererEmitterSettings: { speedFactor?: number; lengthFactor?: number }
  startSpeed: { a?: number; b?: number }
  behaviors: {
    type: string
    frame?: { functions: { function: { p0: number; p1: number; p2: number; p3: number } }[] }
  }[]
}

function systems(node: unknown): NativeSystem[] {
  if (!node || typeof node !== 'object') return []
  const value = node as Record<string, unknown>
  const result = value.type === 'ParticleEmitter' && value.ps ? [value.ps as NativeSystem] : []
  if (Array.isArray(value.children)) {
    for (const child of value.children) result.push(...systems(child))
  }
  return result
}

describe('native Quarks particle documents', () => {
  it('stores every game effect as a Three.js Object3D document with ParticleEmitters', () => {
    expect(Object.keys(bundled)).toHaveLength(6)
    for (const document of Object.values(bundled)) {
      expect(quarksDocumentSchema.parse(document)).toEqual(document)
    }
  })

  it('uses Quarks built-in curve and frame behaviors, not game-specific behaviors', () => {
    const source = JSON.stringify(Object.values(bundled))
    expect(source).toContain('FrameOverLife')
    expect(source).toContain('PiecewiseBezier')
    expect(source).not.toMatch(/GroundBolt|TileOverLife|"type":"Curve"/)
  })

  it('keeps sprite-sheet frame curves inside their atlas and preserves impact render modes', () => {
    for (const [file, raw] of Object.entries(bundled)) {
      const document = raw as {
        object: unknown
        materials: { uuid: string; map: string }[]
        textures: { uuid: string; image: string }[]
        images: { uuid: string; url: string }[]
      }
      const materialMaps = new Map(
        document.materials.map((material) => [material.uuid, material.map]),
      )
      const imageIds = new Map(document.textures.map((texture) => [texture.uuid, texture.image]))
      const imageUrls = new Map(document.images.map((image) => [image.uuid, image.url]))
      for (const system of systems(document.object)) {
        for (const behavior of system.behaviors.filter((item) => item.type === 'FrameOverLife')) {
          for (const segment of behavior.frame!.functions) {
            for (const value of Object.values(segment.function)) {
              expect(value).toBeGreaterThanOrEqual(0)
              expect(value).toBeLessThan(system.uTileCount * system.vTileCount)
            }
          }
        }
      }

      const modesForTexture = (url: string) =>
        systems(document.object)
          .filter((system) => {
            const textureId = materialMaps.get(system.material)
            const imageId = textureId && imageIds.get(textureId)
            return imageId && imageUrls.get(imageId) === url
          })
          .map((system) => system.renderMode)
      if (file.endsWith('/lightning-impact.json')) {
        expect((document.object as { matrix: number[] }).matrix).toEqual([
          1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
        ])
        expect(modesForTexture('assets/textures/fx/lightning-3x3.png')).toEqual([1])
        expect(modesForTexture('assets/textures/fx/circlestretchy.png')).toEqual([1])
        expect(modesForTexture('assets/textures/fx/ring.png')).toEqual([4])
        expect(
          systems(document.object)
            .filter((system) => system.renderMode === 1)
            .map((system) => system.rendererEmitterSettings.lengthFactor),
        ).toEqual([4, -4])
        expect(
          systems(document.object)
            .filter((system) => system.rendererEmitterSettings.lengthFactor === 4)
            .map((system) => [system.startSpeed.a, system.startSpeed.b]),
        ).toEqual([[0.5, 4]])
        expect(
          systems(document.object)
            .filter((system) => system.rendererEmitterSettings.lengthFactor === 4)
            .map((system) => system.shape.thickness),
        ).toEqual([1])
      }
    }
  })

  it('preserves Unity LightningCenter negative stretch and all nine atlas frames', () => {
    const lightning = systems(lightningImpact.object).find(
      (system) => system.uTileCount === 3 && system.vTileCount === 3,
    )!
    // BulletLightning.prefab: LightningCenter uses Stretch, velocity 0, length -4.
    expect(lightning.renderMode).toBe(1)
    expect(lightning.rendererEmitterSettings).toEqual({ speedFactor: 0, lengthFactor: -4 })
    // shortcut: FrameOverLife cannot sample Unity's two curves; use the max curve until supported.
    const frame = new FrameOverLife(
      PiecewiseBezier.fromJSON(
        lightning.behaviors.find((behavior) => behavior.type === 'FrameOverLife')!.frame!,
      ),
    )
    const particle = new SpriteParticle()
    particle.life = 1
    frame.initialize(particle)
    const samples = [
      [0, 0],
      [0.12, 1],
      [0.5, 4],
      [0.9, 8],
      [0.9999, 8],
    ] as const
    for (const [age, tile] of samples) {
      particle.age = age
      frame.update(particle, 0)
      expect(particle.uvTile).toBeCloseTo(age * 9 * 0.9999)
      expect(Math.floor(particle.uvTile)).toBe(tile)
    }
  })

  it('rejects groups without an emitter and unsafe texture URLs', () => {
    const empty = {
      metadata: { version: 4.7, type: 'Object' },
      object: { type: 'Group', children: [] },
    }
    expect(quarksDocumentSchema.safeParse(empty).success).toBe(false)

    const effect = structuredClone(Object.values(bundled)[0]!) as {
      images: { url: string }[]
    }
    effect.images[0]!.url = 'javascript:alert(1)'
    expect(quarksDocumentSchema.safeParse(effect).success).toBe(false)
  })

  it('keeps expired preview emitters editable without changing authored autoDestroy flags', () => {
    const scene = new Scene()
    const group = new Group()
    const batch = new BatchedRenderer()
    const material = new MeshBasicMaterial()
    const systems = [true, false].map(
      (autoDestroy) =>
        new ParticleSystem({
          material,
          autoDestroy,
          looping: false,
          duration: 0.01,
          startLife: new ConstantValue(0.01),
          emissionOverTime: new ConstantValue(0),
        }),
    )
    scene.add(group, batch)
    for (const system of systems) {
      group.add(system.emitter)
      batch.addSystem(system)
    }
    for (let i = 0; i < 10; i++) updateParticlePreview(batch, systems, 1 / 60)
    expect(group.children).toHaveLength(2)
    expect(systems.map((system) => system.autoDestroy)).toEqual([true, false])
    for (const system of systems) system.restart()
    for (let i = 0; i < 10; i++) batch.update(1 / 60)
    expect(group.children).toEqual([systems[1]!.emitter])
    for (const system of systems) system.dispose()
    material.dispose()
  })
})
