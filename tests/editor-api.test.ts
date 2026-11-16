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
beforeAll(async () => {
  await mkdir(path.join(tmpdir(), 'opencode'), { recursive: true })
  directory = await mkdtemp(path.join(tmpdir(), 'opencode', 'bug-battle-editor-'))
  await mkdir(path.join(directory, 'src/content/heads'), { recursive: true })
  await mkdir(path.join(directory, 'public/particles'), { recursive: true })
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

  it('lists particle ids from the static project folder', async () => {
    await writeFile(path.join(directory, 'public/particles/test-effect.json'), '{}')
    await writeFile(path.join(directory, 'public/particles/invalid id.json'), '{}')
    const listed = await fetch(`${baseUrl}/particle-ids`)
    expect(await listed.json()).toEqual({ effects: [{ id: 'test-effect' }] })
  })
})
