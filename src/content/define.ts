import { z } from 'zod'

/**
 * Content definition for a head or body part.
 *
 * A part is pure data: stats, an optional attack descriptor and an optional
 * model key. Adding a new head or body means adding one file under
 * src/content/heads or src/content/bodies. No engine code changes required.
 */
export type Slot = 'head' | 'body'

export const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

const onLandSchema = z.object({
  /** Delay before the area becomes dangerous. */
  delay: z.number().min(0).default(0),
  duration: z.number().positive(),
  radius: z.number().positive(),
})

const projectileSchema = z.object({
  speed: z.number().positive(),
  ttl: z.number().positive(),
  visual: z.string().min(1),
  damage: z.number().int().positive().default(1),
  /** When set the projectile deals no damage while flying, only on landing. */
  onLand: onLandSchema.optional(),
})

const attackSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('projectile'),
    cooldown: z.number().positive(),
    mount: z.enum(['forward', 'sides']),
    projectile: projectileSchema,
  }),
  z.object({
    kind: z.literal('cone'),
    cooldown: z.number().positive(),
    cone: z.object({
      range: z.number().positive(),
      halfAngleDeg: z.number().positive().max(180),
      duration: z.number().positive(),
    }),
  }),
])

const baseSchema = z.object({
  id: z.string().regex(idPattern),
  name: z.string().min(1),
  /** Asset key. Defaults to the part id. */
  model: z.string().optional(),
  hp: z.number().int().positive(),
  /** Score awarded to whoever destroys this part. */
  score: z.number().int().min(0),
  contact: z.object({ damage: z.number().int().min(0) }),
  attack: attackSchema.optional(),
})

const partSchema = baseSchema.extend({
  slot: z.enum(['head', 'body']),
  model: z.string().min(1),
})

export type PartInput = z.input<typeof baseSchema>
export type AttackDef = z.infer<typeof attackSchema>
export type PartDef = z.infer<typeof partSchema>

function define(slot: Slot, input: PartInput): PartDef {
  return partSchema.parse({ ...input, slot, model: input.model ?? input.id })
}

export const defineHead = (input: PartInput): PartDef => define('head', input)
export const defineBody = (input: PartInput): PartDef => define('body', input)

/** Re-validates a definition loaded from disk, so bad content fails at startup. */
export const parsePart = (value: unknown): PartDef => partSchema.parse(value)
