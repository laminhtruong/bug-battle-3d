import { z } from 'zod'

/**
 * Content definition for a head or body part.
 *
 * A part is pure data: stats, an optional attack descriptor, its collider boxes
 * and an optional model key. Adding a new head or body means adding one JSON
 * file under src/content/heads or src/content/bodies. No engine code changes
 * needed.
 */
export type Slot = 'head' | 'body'

export const idPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Parts render at the size they are authored at, so raw prefab numbers
 * (collider boxes, spawn points, offsets) are already arena units.
 */

/** The Unity prefabs lift the art above the pivot by this many arena units. */
export const PART_LIFT = 0.5

export type EulerDegrees = [number, number, number]
export type Quaternion = [number, number, number, number]

function multiplyQuaternions(
  [ax, ay, az, aw]: Quaternion,
  [bx, by, bz, bw]: Quaternion,
): Quaternion {
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** Unity Quaternion.Euler order: rotate around Z, then X, then Y. */
export function boxQuaternion([x, y, z]: EulerDegrees): Quaternion {
  const hx = (x * Math.PI) / 360
  const hy = (y * Math.PI) / 360
  const hz = (z * Math.PI) / 360
  const qx: Quaternion = [Math.sin(hx), 0, 0, Math.cos(hx)]
  const qy: Quaternion = [0, Math.sin(hy), 0, Math.cos(hy)]
  const qz: Quaternion = [0, 0, Math.sin(hz), Math.cos(hz)]
  return multiplyQuaternions(multiplyQuaternions(qy, qx), qz)
}

function rotateByQuaternion(
  [qx, qy, qz, qw]: Quaternion,
  [px, py, pz]: [number, number, number],
): [number, number, number] {
  const tx = 2 * (qy * pz - qz * py)
  const ty = 2 * (qz * px - qx * pz)
  const tz = 2 * (qx * py - qy * px)
  return [
    px + qw * tx + (qy * tz - qz * ty),
    py + qw * ty + (qz * tx - qx * tz),
    pz + qw * tz + (qx * ty - qy * tx),
  ]
}

/** Rotates a prefab point by a box's Unity transform rotation. */
export function rotateBoxPoint(
  rotation: EulerDegrees,
  point: [number, number, number],
): [number, number, number] {
  return rotateByQuaternion(boxQuaternion(rotation), point)
}

/** Turns a rotated centre back into the prefab's m_Center. */
export function unrotateBoxPoint(
  rotation: EulerDegrees,
  point: [number, number, number],
): [number, number, number] {
  const [x, y, z, w] = boxQuaternion(rotation)
  return rotateByQuaternion([-x, -y, -z, w], point)
}

const onLandSchema = z.object({
  /** Delay before the area becomes dangerous. */
  delay: z.number().min(0).default(0),
  duration: z.number().positive(),
  radius: z.number().positive(),
})

/**
 * Default muzzle height in raw prefab units. It is the height shots used before
 * spawn points could move on Y.
 */
export const DEFAULT_SPAWN_Y = 2

/** A muzzle in raw prefab units, relative to the part pivot. */
const spawnPointSchema = z.object({
  x: z.number(),
  y: z.number().default(DEFAULT_SPAWN_Y),
  z: z.number(),
  /** Firing direction relative to the part facing, in degrees. */
  angle: z.number().default(0),
})

export type SpawnPoint = z.infer<typeof spawnPointSchema>

const projectileSchema = z.object({
  speed: z.number().positive(),
  ttl: z.number().positive(),
  visual: z.string().min(1),
  damage: z.number().int().positive().default(1),
  /** Every muzzle fires once per cooldown. */
  spawnPoints: z
    .array(spawnPointSchema)
    .min(1)
    .default(() => [{ x: 0, y: DEFAULT_SPAWN_Y, z: 1.96, angle: 0 }]),
  /** When set the projectile deals no damage while flying, only on landing. */
  onLand: onLandSchema.optional(),
})

const attackSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('projectile'),
    cooldown: z.number().positive(),
    projectile: projectileSchema,
  }),
  z.object({
    kind: z.literal('cone'),
    cooldown: z.number().positive(),
    cone: z.object({
      range: z.number().positive(),
      halfAngleDeg: z.number().positive().max(180),
      duration: z.number().positive(),
      /** Cone origins. Angle rotates the cone relative to the part facing. */
      spawnPoints: z
        .array(spawnPointSchema)
        .min(1)
        .default(() => [{ x: 0, y: DEFAULT_SPAWN_Y, z: 0, angle: 0 }]),
    }),
  }),
])

/**
 * A trigger BoxCollider in raw prefab units, which are arena units because the
 * art renders at its authored size. The simulation runs on the XZ plane, but Y
 * is kept so the editor can draw the box at the same height as the art.
 */
const prefabBoxSchema = z.object({
  center: z.tuple([z.number(), z.number(), z.number()]),
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  /**
   * The rotation of the GameObject the collider is attached to, in Unity Euler
   * degrees. The box centre and its axes both rotate around the part pivot.
   */
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  /**
   * True for the prefab's "Claw" colliders. Only these boxes deal contact
   * damage; every box is a hurtbox that projectiles and attacks can hit.
   */
  hitbox: z.boolean().default(false),
})

/** A collider box in part-local arena units, ready for the simulation. */
export interface ColliderBox {
  /** Centre after the prefab rotation is applied, in arena units. */
  x: number
  y: number
  z: number
  halfWidth: number
  halfHeight: number
  halfDepth: number
  /** Unity transform rotation in degrees, kept for the editor. */
  rotation: EulerDegrees
  /** Yaw of the rotated box on the XZ plane, in radians. */
  angle: number
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
  /**
   * Shifts the art only, in raw prefab units like `boxes`. Used to line a head
   * up with the body chain without moving its colliders.
   */
  offset: z.tuple([z.number(), z.number()]).default([0, 0]),
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
      y: z.number(),
      z: z.number(),
      halfWidth: z.number().positive(),
      halfHeight: z.number().positive(),
      halfDepth: z.number().positive(),
      rotation: z.tuple([z.number(), z.number(), z.number()]),
      angle: z.number(),
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
export type ParsedPartInput = z.output<typeof inputSchema>
export type AttackDef = z.infer<typeof attackSchema>
export type PartDef = z.infer<typeof partSchema>

/** Validates a part file before it is written to disk. */
export const parsePartInput = (value: unknown): ParsedPartInput => inputSchema.parse(value)

function buildCollider(boxes: z.infer<typeof prefabBoxSchema>[]): PartCollider {
  const scaled = boxes.map((box) => {
    // The prefab rotates the box's GameObject, so the centre and the axes both
    // turn around the part pivot.
    const center = rotateBoxPoint(box.rotation, box.center)
    const forward = rotateBoxPoint(box.rotation, [0, 0, 1])
    return {
      x: center[0],
      y: center[1],
      z: center[2],
      halfWidth: box.size[0] / 2,
      halfHeight: box.size[1] / 2,
      halfDepth: box.size[2] / 2,
      rotation: box.rotation,
      // The 2D footprint only needs the yaw; tilt is negligible on this plane.
      angle: Math.atan2(forward[0], forward[2]),
      hitbox: box.hitbox,
    }
  })
  const reach = scaled.reduce(
    (max, box) =>
      Math.max(max, Math.hypot(box.x, box.z) + Math.hypot(box.halfWidth, box.halfDepth)),
    0,
  )
  return { boxes: scaled, reach }
}

function define(slot: Slot, input: PartInput): PartDef {
  const parsed = parsePartInput(input)
  const { boxes, ...rest } = parsed
  return partSchema.parse({
    ...rest,
    slot,
    model: parsed.model ?? parsed.id,
    collider: buildCollider(boxes),
  })
}

export const definePart = (slot: Slot, input: PartInput): PartDef => define(slot, input)
export const defineHead = (input: PartInput): PartDef => definePart('head', input)
export const defineBody = (input: PartInput): PartDef => definePart('body', input)
