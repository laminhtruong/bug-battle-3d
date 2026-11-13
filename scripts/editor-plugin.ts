import { readdir, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import type { Plugin, ViteDevServer } from 'vite'
import { unrotateBoxPoint } from '../src/content/define.ts'
import type { PartDef, Slot } from '../src/content/define'

/**
 * Dev-only API behind the part editor. It reads and writes the same TypeScript
 * files the game ships, so the editor is another authoring path for content.
 */

const ROUTE = '/editor/api'
const SLOTS: readonly Slot[] = ['head', 'body']
const CONTENT_DIRS: Record<Slot, string> = { head: 'heads', body: 'bodies' }
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Set from the Vite config, because `import.meta.url` points at the bundled config. */
let projectRoot = process.cwd()

export interface PrefabBoxDraft {
  center: [number, number, number]
  size: [number, number, number]
  /** Unity transform rotation in degrees, ZXY order. */
  rotation?: [number, number, number]
  hitbox?: boolean
}

export interface PartDraft {
  id: string
  name: string
  model?: string
  hp: number
  score: number
  contact: { damage: number }
  boxes: PrefabBoxDraft[]
  offset?: [number, number]
  attack?: unknown
}

export interface LoadedPartDraft {
  slot: Slot
  file: string
  draft: PartDraft
}

function snap(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/** Turns the scaled runtime definition back into the raw prefab-unit input. */
export function partToDraft(part: PartDef, scale: number): PartDraft {
  const offset = part.offset ?? [0, 0]
  return {
    id: part.id,
    name: part.name,
    model: part.model,
    hp: part.hp,
    score: part.score,
    contact: { damage: part.contact.damage },
    boxes: part.collider.boxes.map((box) => {
      const center = unrotateBoxPoint(box.rotation, [box.x / scale, box.y / scale, box.z / scale])
      return {
        center: center.map(snap) as [number, number, number],
        size: [
          snap((box.halfWidth * 2) / scale),
          snap((box.halfHeight * 2) / scale),
          snap((box.halfDepth * 2) / scale),
        ],
        ...(box.rotation.some((value) => value !== 0)
          ? { rotation: box.rotation.map(snap) as [number, number, number] }
          : {}),
        ...(box.hitbox ? { hitbox: true } : {}),
      }
    }),
    ...(offset[0] || offset[1] ? { offset: [snap(offset[0]), snap(offset[1])] } : {}),
    ...(part.attack ? { attack: part.attack } : {}),
  }
}

/** Builds the TypeScript source for a part file, without defaults noise. */
export async function draftToSource(slot: Slot, draft: PartDraft, file: string): Promise<string> {
  const offset = draft.offset ?? [0, 0]
  const value = {
    id: draft.id,
    name: draft.name,
    ...(draft.model && draft.model !== draft.id ? { model: draft.model } : {}),
    hp: draft.hp,
    score: draft.score,
    contact: { damage: draft.contact.damage },
    ...(offset[0] || offset[1] ? { offset } : {}),
    boxes: draft.boxes.map((box) => ({
      center: box.center,
      size: box.size,
      ...(box.rotation?.some((value) => value !== 0) ? { rotation: box.rotation } : {}),
      ...(box.hitbox ? { hitbox: true } : {}),
    })),
    ...(draft.attack ? { attack: draft.attack } : {}),
  }
  const define = slot === 'head' ? 'defineHead' : 'defineBody'
  const source = `import { ${define} } from '../define'\n\nexport default ${define}(${JSON.stringify(
    value,
    null,
    2,
  )})\n`
  const config = (await resolveConfig(file)) ?? {}
  return format(source, { ...config, parser: 'typescript', filepath: file })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      data += chunk
      if (data.length > 1_000_000) {
        reject(new Error('request body is too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function partFile(slot: Slot, id: string): string {
  if (!SLOTS.includes(slot)) {
    throw new Error(`unknown slot: ${String(slot)}`)
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error('part id must be kebab-case')
  }
  return path.join(projectRoot, 'src', 'content', CONTENT_DIRS[slot], `${id}.ts`)
}

async function listParts(server: ViteDevServer): Promise<LoadedPartDraft[]> {
  const define = await server.ssrLoadModule('/src/content/define.ts')
  const parts: LoadedPartDraft[] = []
  for (const slot of SLOTS) {
    const directory = path.join(projectRoot, 'src', 'content', CONTENT_DIRS[slot])
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) {
        continue
      }
      // The file mtime busts the module cache only when the source changes.
      const modified = await stat(path.join(directory, entry.name))
      const module = await server.ssrLoadModule(
        `/src/content/${CONTENT_DIRS[slot]}/${entry.name}?t=${modified.mtimeMs}`,
      )
      const part = define.parsePart(module.default) as PartDef
      if (part.slot !== slot) {
        throw new Error(`part "${part.id}" is registered as ${part.slot}, expected ${slot}`)
      }
      parts.push({ slot, file: entry.name, draft: partToDraft(part, define.PART_SCALE) })
    }
  }
  return parts.sort((first, second) => first.draft.id.localeCompare(second.draft.id))
}

async function savePart(server: ViteDevServer, req: IncomingMessage): Promise<LoadedPartDraft> {
  const body = JSON.parse(await readBody(req)) as { slot?: Slot; draft?: PartDraft }
  if (!body.slot || !SLOTS.includes(body.slot) || !body.draft) {
    throw new Error('expected { slot, draft }')
  }
  const draft = body.draft
  if (draft.model && !ID_PATTERN.test(draft.model)) {
    throw new Error('model must be kebab-case')
  }
  const file = partFile(body.slot, draft.id)
  const define = await server.ssrLoadModule('/src/content/define.ts')
  // Validate before touching the file; a broken editor save must not break boot.
  const parsed = define.parsePartInput(draft) as {
    contact: { damage: number }
    boxes: { hitbox?: boolean }[]
  }
  if (parsed.contact.damage > 0 && !parsed.boxes.some((box) => box.hitbox)) {
    throw new Error('contact damage requires at least one claw box')
  }
  await writeFile(file, await draftToSource(body.slot, draft, file), 'utf8')
  return { slot: body.slot, file: path.basename(file), draft }
}

async function deletePart(url: URL): Promise<void> {
  const slot = url.searchParams.get('slot') as Slot | null
  const id = url.searchParams.get('id') ?? ''
  if (!slot) {
    throw new Error('missing slot')
  }
  await rm(partFile(slot, id))
}

async function listModels(url: URL): Promise<string[]> {
  const slot = url.searchParams.get('slot') as Slot | null
  if (!slot || !SLOTS.includes(slot)) {
    throw new Error('unknown slot')
  }
  const entries = await readdir(
    path.join(projectRoot, 'public', 'assets', 'models', 'parts', slot),
    {
      withFileTypes: true,
    },
  )
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.glb'))
    .map((entry) => entry.name.slice(0, -'.glb'.length))
    .sort()
}

async function handle(
  server: ViteDevServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (url.pathname === '/parts' && req.method === 'GET') {
      send(res, 200, { parts: await listParts(server) })
      return
    }
    if (url.pathname === '/parts' && req.method === 'POST') {
      send(res, 200, { part: await savePart(server, req) })
      return
    }
    if (url.pathname === '/parts' && req.method === 'DELETE') {
      await deletePart(url)
      send(res, 200, { ok: true })
      return
    }
    if (url.pathname === '/models' && req.method === 'GET') {
      send(res, 200, { models: await listModels(url) })
      return
    }
    send(res, 404, { error: 'not found' })
  } catch (error) {
    send(res, 400, { error: error instanceof Error ? error.message : 'editor request failed' })
  }
}

export function editorPlugin(): Plugin {
  return {
    name: 'bug-battle-editor',
    apply: 'serve',
    configureServer(server) {
      projectRoot = server.config.root
      server.middlewares.use(ROUTE, (req, res) => {
        void handle(server, req, res)
      })
    },
  }
}
