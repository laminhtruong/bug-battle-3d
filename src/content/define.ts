import { z } from 'zod'

/**
 * Content definition for a head or body part.
 *
 * A part is pure data: stats, an optional attack descriptor, its collider boxes
 * and an optional model key. Adding a new head or body means adding one file
 * under src/content/heads or src/content/bodies. No engine code changes needed.
 */
export type Slot = 'head' | 'body'

export const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** The Unity prefabs scale art and collider boxes by this factor. */
export const PART_SCALE = 0.25

/** The Unity prefabs lift the art above the pivot by this many arena units. */
export const PART_LIFT = 0.125

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

/**
 * A trigger BoxCollider copied from the Unity part prefab. Values are the raw
 * prefab units; the definition scales them to arena units. Only the XZ plane
 * matters for gameplay, so the y component of the Unity values is dropped.
 */
const prefabBoxSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  size: z.tuple([z.number().positive(), z.number().positive()]),
  /**
   * True for the prefab's "Claw" colliders. Only these boxes deal contact
   * damage; every box is a hurtbox that projectiles and attacks can hit.
   */
  hitbox: z.boolean().default(false),
})

/** A collider box in part-local arena units, ready for the simulation. */
export interface ColliderBox {
  x: number
  z: number
  halfWidth: number
  halfDepth: number
  hitbox: boolean
}

export interface PartCollider {
  boxes: ColliderBox[]
  /** Farthest corner distance from the pivot, used as a broad-phase radius. */
  reach: number
}

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

const inputSchema = baseSchema.extend({
  boxes: z.array(prefabBoxSchema).min(1),
})

const colliderSchema = z.object({
  boxes: z.array(
    z.object({
      x: z.number(),
      z: z.number(),
      halfWidth: z.number().positive(),
      halfDepth: z.number().positive(),
      hitbox: z.boolean(),
    }),
  ),
  reach: z.number().positive(),
})

const partSchema = baseSchema.extend({
  slot: z.enum(['head', 'body']),
  model: z.string().min(1),
  collider: colliderSchema,
})

export type PartInput = z.input<typeof inputSchema>
export type AttackDef = z.infer<typeof attackSchema>
export type PartDef = z.infer<typeof partSchema>

function buildCollider(boxes: z.infer<typeof prefabBoxSchema>[]): PartCollider {
  const scaled = boxes.map((box) => ({
    x: box.center[0] * PART_SCALE,
    z: box.center[1] * PART_SCALE,
    halfWidth: (box.size[0] * PART_SCALE) / 2,
    halfDepth: (box.size[1] * PART_SCALE) / 2,
    hitbox: box.hitbox,
  }))
  const reach = scaled.reduce(
    (max, box) =>
      Math.max(max, Math.hypot(Math.abs(box.x) + box.halfWidth, Math.abs(box.z) + box.halfDepth)),
    0,
  )
  return { boxes: scaled, reach }
}

function define(slot: Slot, input: PartInput): PartDef {
  const parsed = inputSchema.parse(input)
  const { boxes, ...rest } = parsed
  return partSchema.parse({
    ...rest,
    slot,
    model: parsed.model ?? parsed.id,
    collider: buildCollider(boxes),
  })
}

export const defineHead = (input: PartInput): PartDef => define('head', input)
export const defineBody = (input: PartInput): PartDef => define('body', input)

/** Re-validates a definition loaded from disk, so bad content fails at startup. */
export const parsePart = (value: unknown): PartDef => partSchema.parse(value)
