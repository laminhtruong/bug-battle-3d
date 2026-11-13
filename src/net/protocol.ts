import { z } from 'zod'
import { SOUND_NAMES } from '@/data/sounds'

/**
 * Wire protocol. Bump the version when the message shape changes; hosts and
 * guests with different versions refuse to start instead of desyncing.
 */
export const PROTOCOL_VERSION = 5

const MAX_CLIENT_MESSAGE = 4096
const MAX_HOST_MESSAGE = 200_000

export const lobbyPlayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(16),
})

export type LobbyPlayer = z.infer<typeof lobbyPlayerSchema>

export const resultRowSchema = z.object({
  name: z.string().min(1).max(16),
  score: z.number().int(),
})

export type ResultRow = z.infer<typeof resultRowSchema>

export const helloSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('hello'),
  name: z.string().trim().min(1).max(16),
  contentHash: z.string().length(8),
})

export const inputSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('input'),
  seq: z.number().int().nonnegative(),
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
})

export const clientMessageSchema = z.discriminatedUnion('t', [helloSchema, inputSchema])
export type ClientMessage = z.infer<typeof clientMessageSchema>

const segmentSchema = z.object({
  partId: z.string().min(1),
  slot: z.enum(['head', 'body']),
  dead: z.boolean(),
  x: z.number(),
  z: z.number(),
  angle: z.number(),
  hurtUntil: z.number(),
})

const snakeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(16),
  control: z.enum(['human', 'bot', 'enemy']),
  slot: z.number().int(),
  alive: z.boolean(),
  score: z.number(),
  segments: z.array(segmentSchema),
})

const projectileSchema = z.object({
  id: z.string().min(1),
  visual: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

const areaSchema = z.object({
  id: z.string().min(1),
  partId: z.string().min(1),
  x: z.number(),
  z: z.number(),
  radius: z.number(),
})

const pickupSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['apple', 'heal', 'head', 'body']),
  partId: z.string().optional(),
  x: z.number(),
  z: z.number(),
})

export const snapshotSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('snap'),
  time: z.number(),
  duration: z.number(),
  ended: z.boolean(),
  snakes: z.array(snakeSchema),
  projectiles: z.array(projectileSchema),
  areas: z.array(areaSchema),
  pickups: z.array(pickupSchema),
  /** Sound effects that happened since the previous snapshot, per snake. */
  sfx: z
    .array(z.object({ by: z.string().min(1).max(32), name: z.enum(SOUND_NAMES) }))
    .max(64)
    .optional(),
})

export type Snapshot = z.infer<typeof snapshotSchema>

export const welcomeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('welcome'),
  playerId: z.string().min(1),
})

export const lobbySchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('lobby'),
  players: z.array(lobbyPlayerSchema),
})

export const startSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('start'),
  seed: z.number().int(),
  contentHash: z.string().length(8),
  players: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(16),
      slot: z.number().int(),
      headId: z.string().min(1),
    }),
  ),
})

export const endSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('end'),
  results: z.array(resultRowSchema),
})

export const errorSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  t: z.literal('error'),
  message: z.string().min(1).max(200),
})

export const hostMessageSchema = z.discriminatedUnion('t', [
  welcomeSchema,
  lobbySchema,
  startSchema,
  snapshotSchema,
  endSchema,
  errorSchema,
])

export type HostMessage = z.infer<typeof hostMessageSchema>

export function parseClientMessage(raw: unknown): ClientMessage | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_CLIENT_MESSAGE) {
    return undefined
  }
  try {
    const parsed = clientMessageSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function parseHostMessage(raw: unknown): HostMessage | undefined {
  if (typeof raw !== 'string' || raw.length > MAX_HOST_MESSAGE) {
    return undefined
  }
  try {
    const parsed = hostMessageSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function encodeMessage(message: unknown): string {
  return JSON.stringify(message)
}
