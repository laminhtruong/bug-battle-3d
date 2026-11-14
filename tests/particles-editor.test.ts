import { describe, expect, it } from 'vitest'
import { quarksDocumentSchema } from '@/content/particles'

const bundled = import.meta.glob('../src/content/particles/*.json', {
  eager: true,
  import: 'default',
})

interface NativeSystem {
  material: string
  uTileCount: number
  vTileCount: number
  renderMode: number
  rendererEmitterSettings: { speedFactor?: number; lengthFactor?: number }
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

  it('keeps sprite-sheet frame curves inside their atlas and faces lightning sprites toward the camera', () => {
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
        expect(modesForTexture('assets/textures/fx/lightning-3x3.png')).toEqual([1])
        expect(modesForTexture('assets/textures/fx/circlestretchy.png')).toEqual([1])
        expect(modesForTexture('assets/textures/fx/ring.png')).toEqual([4])
        expect(
          systems(document.object)
            .filter((system) => system.renderMode === 1)
            .map((system) => system.rendererEmitterSettings.lengthFactor),
        ).toEqual([4, 2.6])
      }
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
})
