import { describe, expect, it } from 'vitest'
import { particleEffectSchema } from '@/content/particles'
import { PARTICLE_PRESETS } from '@/render/particles'

describe('particle editor content', () => {
  it('keeps every shipped effect editable through the save schema', () => {
    for (const effect of Object.values(PARTICLE_PRESETS)) {
      expect(particleEffectSchema.parse(effect)).toEqual(effect)
    }
  })

  it('rejects unsafe ids and invalid particle values before saving', () => {
    const effect = structuredClone(PARTICLE_PRESETS['lightning-orb']!)
    expect(particleEffectSchema.safeParse({ ...effect, id: '../outside' }).success).toBe(false)
    effect.systems[0]!.duration = -1
    expect(particleEffectSchema.safeParse(effect).success).toBe(false)
  })
})
