import { afterEach, describe, expect, it, vi } from 'vitest'
import { createParticleProject } from '@/editor/particle-project'
import deathExplosion from '@/content/particles/death-explosion.json'
import { parseQuarksDocument } from '@/content/particles'

afterEach(() => vi.unstubAllGlobals())

describe('game particle editor adapter', () => {
  it('supplies game presets, overrides, and texture URLs to the external editor', async () => {
    const custom = { id: 'custom-effect', json: parseQuarksDocument(deathExplosion) }
    const override = structuredClone(custom.json)
    override.object.name = 'Edited explosion'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.endsWith('/particle-textures')
            ? { textures: ['circle', 'fire'] }
            : { effects: [custom, { id: 'death-explosion', json: override }] },
      })),
    )
    const project = createParticleProject()
    const effects = await project.listEffects!()
    expect(effects).toHaveLength(8)
    expect(effects.find((effect) => effect.id === 'death-explosion')).toMatchObject({
      json: { object: { name: 'Edited explosion' } },
      defaultJson: deathExplosion,
    })
    expect(effects.find((effect) => effect.id === 'custom-effect')?.defaultJson).toBeUndefined()
    expect(await project.listTextures!()).toEqual([
      { id: 'circle', url: 'assets/textures/fx/circle.png' },
      { id: 'fire', url: 'assets/textures/fx/fire.png' },
    ])
  })

  it('writes only overrides and makes resetting an unmodified preset a no-op', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const project = createParticleProject()
    await project.deleteEffect!('death-explosion')
    expect(fetchMock).not.toHaveBeenCalled()
    const json = parseQuarksDocument(deathExplosion)
    await project.saveEffect!('death-explosion', json)
    expect(fetchMock).toHaveBeenCalledWith(
      '/editor/api/particles',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'death-explosion', json }),
      }),
    )
    await project.deleteEffect!('death-explosion')
    expect(fetchMock).toHaveBeenLastCalledWith('/editor/api/particles?id=death-explosion', {
      method: 'DELETE',
    })
  })

  it('propagates project API errors instead of reporting a successful save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })),
    )
    await expect(
      createParticleProject().saveEffect!('effect', parseQuarksDocument(deathExplosion)),
    ).rejects.toThrow('Forbidden')
  })
})
