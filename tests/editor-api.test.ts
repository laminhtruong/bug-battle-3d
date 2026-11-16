import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { editorPlugin } from '../scripts/editor-plugin'

let server: ViteDevServer
let directory: string
let baseUrl: string
const draft = {
  id: 'test-head',
  name: 'Test',
  hp: 2,
  score: 10,
  contact: { damage: 0 },
  boxes: [{ center: [0, 0, 0], size: [1, 1, 1] }],
}
const particleDocument = {
  metadata: { version: 4.7, type: 'Object' },
  object: { type: 'Group', children: [{ type: 'ParticleEmitter' }] },
}

beforeAll(async () => {
  await mkdir(path.join(tmpdir(), 'opencode'), { recursive: true })
  directory = await mkdtemp(path.join(tmpdir(), 'opencode', 'bug-battle-editor-'))
  await mkdir(path.join(directory, 'src/content/heads'), { recursive: true })
  await mkdir(path.join(directory, 'public/particle-defaults'), { recursive: true })
  server = await createServer({
    configFile: false,
    root: directory,
    plugins: [editorPlugin()],
    server: { host: '127.0.0.1', port: 0, watch: null },
  })
  await server.listen()
  baseUrl = `${server.resolvedUrls!.local[0]}editor/api`
})

afterAll(async () => {
  await server?.close()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('editor API', () => {
  it('saves parsed defaults rather than serializing unchecked request fields', async () => {
    const response = await fetch(`${baseUrl}/parts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slot: 'head',
        draft: {
          ...draft,
          attack: {
            kind: 'projectile',
            cooldown: 1,
            projectile: { speed: 5, ttl: 1, visual: 'bullet' },
          },
        },
      }),
    })
    expect(response.status).toBe(200)
    const saved = await response.json()
    expect(saved.part.draft.attack.projectile.damage).toBe(1)
    expect(saved.part.draft.attack.projectile.spawnPoints).toHaveLength(1)
    const json = JSON.parse(
      await readFile(path.join(directory, 'src/content/heads/test-head.json'), 'utf8'),
    )
    expect(json.attack.projectile.spawnPoints).toHaveLength(1)
  })

  it.each(['POST', 'DELETE'])(
    'blocks cross-origin %s requests before touching content',
    async (method) => {
      const file = path.join(directory, 'src/content/heads/protected-head.json')
      await writeFile(file, 'original content')
      const response = await fetch(`${baseUrl}/parts?slot=head&id=protected-head`, {
        method,
        headers: { 'content-type': 'text/plain', origin: 'https://attacker.example' },
        ...(method === 'POST'
          ? { body: JSON.stringify({ slot: 'head', draft: { ...draft, id: 'protected-head' } }) }
          : {}),
      })
      expect(response.status).toBe(403)
      expect(await readFile(file, 'utf8')).toBe('original content')
    },
  )

  it('serves project JSON files, saves them in public, and restores reset defaults', async () => {
    const active = { ...particleDocument, object: { ...particleDocument.object, name: 'Edited' } }
    await writeFile(path.join(directory, 'public/test-effect.json'), JSON.stringify(active))
    await writeFile(
      path.join(directory, 'public/particle-defaults/test-effect.json'),
      JSON.stringify(particleDocument),
    )

    const listed = await fetch(`${baseUrl}/particles`)
    expect(await listed.json()).toEqual({
      effects: [{ id: 'test-effect', json: active, defaultJson: particleDocument }],
    })

    const saved = { ...particleDocument, object: { ...particleDocument.object, name: 'Saved' } }
    expect(
      (
        await fetch(`${baseUrl}/particles`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'test-effect', json: saved }),
        })
      ).status,
    ).toBe(200)
    expect(
      JSON.parse(await readFile(path.join(directory, 'public/test-effect.json'), 'utf8')),
    ).toEqual(saved)

    expect((await fetch(`${baseUrl}/particles?id=test-effect`, { method: 'DELETE' })).status).toBe(
      200,
    )
    expect(
      JSON.parse(await readFile(path.join(directory, 'public/test-effect.json'), 'utf8')),
    ).toEqual(particleDocument)

    await fetch(`${baseUrl}/particles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'custom-effect', json: particleDocument }),
    })
    expect(
      (await fetch(`${baseUrl}/particles?id=custom-effect`, { method: 'DELETE' })).status,
    ).toBe(200)
    await expect(
      readFile(path.join(directory, 'public/custom-effect.json'), 'utf8'),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
