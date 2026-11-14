import type { ParticleEditorOptions, ParticleEffect } from 'quarks-particle-editor'
import { parseQuarksDocument } from '@/content/particles'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/editor/api${path}`, init)
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export function createParticleProject(): ParticleEditorOptions {
  const overrides = new Set<string>()
  return {
    async listEffects() {
      const effects = new Map<string, ParticleEffect>()
      for (const [file, json] of Object.entries(
        import.meta.glob('../content/particles/*.json', { eager: true, import: 'default' }),
      )) {
        const id = file
          .split('/')
          .at(-1)!
          .replace(/\.json$/, '')
        const document = parseQuarksDocument(json)
        effects.set(id, { id, json: document, defaultJson: document })
      }
      const stored = await request<{ effects: ParticleEffect[] }>('/particles')
      for (const effect of stored.effects) {
        const json = parseQuarksDocument(effect.json)
        effects.set(effect.id, { ...effects.get(effect.id), id: effect.id, json })
        overrides.add(effect.id)
      }
      return [...effects.values()]
    },
    async listTextures() {
      const { textures } = await request<{ textures: string[] }>('/particle-textures')
      return textures.map((id) => ({ id, url: `assets/textures/fx/${id}.png` }))
    },
    async saveEffect(id, json) {
      await request('/particles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, json }),
      })
      overrides.add(id)
    },
    async deleteEffect(id) {
      if (!overrides.has(id)) return
      await request(`/particles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      overrides.delete(id)
    },
  }
}
