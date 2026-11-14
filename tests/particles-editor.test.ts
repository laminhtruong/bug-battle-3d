import { describe, expect, it } from 'vitest'
import { quarksDocumentSchema } from '@/content/particles'

const bundled = import.meta.glob('../src/content/particles/*.json', {
  eager: true,
  import: 'default',
})

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
