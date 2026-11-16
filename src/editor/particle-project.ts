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
  return {
    async listEffects() {
      const { effects } = await request<{ effects: ParticleEffect[] }>('/particles')
      return effects.map((effect) => ({
        ...effect,
        json: parseQuarksDocument(effect.json),
        ...(effect.defaultJson ? { defaultJson: parseQuarksDocument(effect.defaultJson) } : {}),
      }))
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
    },
    async deleteEffect(id) {
      await request(`/particles?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
  }
}
