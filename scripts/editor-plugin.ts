import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import type { Plugin } from 'vite'
import { DEFAULT_SPAWN_Y, parsePartInput } from '../src/content/define.ts'
import type { AttackDef, Slot, SpawnPoint } from '../src/content/define'

/**
 * Dev-only API behind the part editor. It reads and writes the same JSON files
 * the game ships, so the editor is another authoring path for content.
 */

const ROUTE = '/editor/api'
const SLOTS: readonly Slot[] = ['head', 'body']
const CONTENT_DIRS: Record<Slot, string> = { head: 'heads', body: 'bodies' }
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Set from the Vite config, because `import.meta.url` points at the bundled config. */
let projectRoot = process.cwd()

export interface BoxDraft {
  center: [number, number, number]
  size: [number, number, number]
  /** Box rotation in degrees, ZXY order. */
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
  boxes: BoxDraft[]
  offset?: [number, number]
  attack?: AttackDef
}

export interface LoadedPartDraft {
  slot: Slot
  file: string
  draft: PartDraft
}

function cleanSpawns(points: SpawnPoint[]): { x: number; y?: number; z: number; angle?: number }[] {
  return points.map(({ x, y, z, angle }) => ({
    x,
    ...(y !== DEFAULT_SPAWN_Y ? { y } : {}),
    z,
    ...(angle !== 0 ? { angle } : {}),
  }))
}

/** Drops defaults that the schema supplies, so editor saves stay small. */
function cleanAttack(attack: AttackDef): unknown {
  if (attack.kind === 'cone') {
    const { range, halfAngleDeg, duration, spawnPoints } = attack.cone
    const isDefault =
      spawnPoints.length === 1 &&
      spawnPoints[0]?.x === 0 &&
      spawnPoints[0]?.y === DEFAULT_SPAWN_Y &&
      spawnPoints[0]?.z === 0 &&
      spawnPoints[0]?.angle === 0
    return {
      kind: 'cone',
      cooldown: attack.cooldown,
      cone: {
        range,
        halfAngleDeg,
        duration,
        ...(isDefault ? {} : { spawnPoints: cleanSpawns(spawnPoints) }),
      },
    }
  }
  const { speed, ttl, visual, damage, spawnPoints, onLand } = attack.projectile
  return {
    kind: 'projectile',
    cooldown: attack.cooldown,
    projectile: {
      speed,
      ttl,
      visual,
      ...(damage !== 1 ? { damage } : {}),
      spawnPoints: cleanSpawns(spawnPoints),
      ...(onLand
        ? {
            onLand: {
              ...(onLand.delay !== 0 ? { delay: onLand.delay } : {}),
              duration: onLand.duration,
              radius: onLand.radius,
              ...(onLand.interval === undefined ? {} : { interval: onLand.interval }),
            },
          }
        : {}),
    },
  }
}

/** Builds the JSON source for a part file, without defaults noise. */
export async function draftToJson(draft: PartDraft, file: string): Promise<string> {
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
    ...(draft.attack ? { attack: cleanAttack(draft.attack) } : {}),
  }
  const config = (await resolveConfig(file)) ?? {}
  return format(JSON.stringify(value), {
    ...config,
    parser: 'json',
    // Keep small collider objects on one line, like the checked-in part files.
    objectWrap: 'collapse',
    filepath: file,
  })
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
  return path.join(projectRoot, 'src', 'content', CONTENT_DIRS[slot], `${id}.json`)
}

async function listParts(): Promise<LoadedPartDraft[]> {
  const parts: LoadedPartDraft[] = []
  for (const slot of SLOTS) {
    const directory = path.join(projectRoot, 'src', 'content', CONTENT_DIRS[slot])
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }
      const source = await readFile(path.join(directory, entry.name), 'utf8')
      const draft = parsePartInput(JSON.parse(source)) as PartDraft
      parts.push({ slot, file: entry.name, draft })
    }
  }
  return parts.sort((first, second) => first.draft.id.localeCompare(second.draft.id))
}

async function savePart(req: IncomingMessage): Promise<LoadedPartDraft> {
  const body = JSON.parse(await readBody(req)) as { slot?: Slot; draft?: PartDraft }
  if (!body.slot || !SLOTS.includes(body.slot) || !body.draft) {
    throw new Error('expected { slot, draft }')
  }
  const draft = body.draft
  if (draft.model && !ID_PATTERN.test(draft.model)) {
    throw new Error('model must be kebab-case')
  }
  const file = partFile(body.slot, draft.id)
  // Validate before touching the file; a broken editor save must not break boot.
  const parsed = parsePartInput(draft)
  if (parsed.contact.damage > 0 && !parsed.boxes.some((box) => box.hitbox)) {
    throw new Error('contact damage requires at least one claw box')
  }
  await writeFile(file, await draftToJson(draft, file), 'utf8')
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

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (url.pathname === '/parts' && req.method === 'GET') {
      send(res, 200, { parts: await listParts() })
      return
    }
    if (url.pathname === '/parts' && req.method === 'POST') {
      send(res, 200, { part: await savePart(req) })
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
        void handle(req, res)
      })
    },
  }
}
