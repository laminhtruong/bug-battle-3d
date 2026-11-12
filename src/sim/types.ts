import type { Vec2 } from '@/core/math2d'
import type { Rng } from '@/core/rng'
import type { ArenaDef } from '@/content/arena'
import type { Slot } from '@/content/define'

export type SnakeControl = 'human' | 'bot' | 'enemy'

export interface Segment {
  partId: string
  slot: Slot
  hp: number
  maxHp: number
  x: number
  z: number
  /** Facing angle, used for attacks and rendering. */
  angle: number
  /** Seconds until the next attack. */
  cooldown: number
  /** Absolute world time before which this segment cannot be hurt again. */
  hurtUntil: number
}

export interface AiState {
  targetX: number
  targetZ: number
  retargetAt: number
}

export interface Snake {
  id: string
  control: SnakeControl
  name: string
  /** Stable player slot, used by the lobby and the HUD. */
  slot: number
  alive: boolean
  /** Absolute world time of the next respawn. */
  respawnAt: number
  x: number
  z: number
  angle: number
  /** Desired direction of travel, filled by input or AI. */
  steerX: number
  steerZ: number
  /** Newest sample last. */
  trail: Vec2[]
  /** Index 0 is the head. */
  segments: Segment[]
  /** Apples eaten since the last growth. */
  food: number
  score: number
  kills: number
  speed: number
  ai: AiState
  /** Head restored on respawn. */
  baseHeadId: string
}

export interface Projectile {
  id: string
  ownerId: string
  partId: string
  visual: string
  x: number
  z: number
  vx: number
  vz: number
  damage: number
  age: number
  ttl: number
  onLand?: { delay: number; duration: number; radius: number }
  landed: boolean
  delayLeft: number
}

export interface Area {
  id: string
  ownerId: string
  partId: string
  x: number
  z: number
  radius: number
  damage: number
  duration: number
  age: number
}

export type PickupKind = 'apple' | 'heal' | 'head' | 'body'

export interface Pickup {
  id: string
  kind: PickupKind
  /** Set for head and body drops. */
  partId?: string
  x: number
  z: number
  expireAt: number
}

export type WorldEvent =
  | {
      type: 'attack'
      snakeId: string
      partId: string
      kind: 'projectile' | 'cone'
      x: number
      z: number
      angle: number
    }
  | {
      type: 'hit'
      /** Snake that took the damage. */
      targetId: string
      /** Snake that caused the damage, when there is one. */
      attackerId?: string
      x: number
      z: number
      damage: number
    }
  | {
      type: 'destroyed'
      /** Snake that lost the part. */
      targetId: string
      /** Snake that destroyed the part, when there is one. */
      attackerId?: string
      x: number
      z: number
      partId: string
      slot: Slot
    }
  | { type: 'death'; snakeId: string; control: SnakeControl; x: number; z: number }
  | { type: 'spawn'; snakeId: string; x: number; z: number }
  | { type: 'pickup'; snakeId: string; pickupId: string; kind: PickupKind; x: number; z: number }
  | { type: 'growth'; snakeId: string }
  | { type: 'round-end' }

export interface World {
  arena: ArenaDef
  rng: Rng
  tick: number
  time: number
  duration: number
  ended: boolean
  snakes: Snake[]
  projectiles: Projectile[]
  areas: Area[]
  pickups: Pickup[]
  /** Accumulated this tick, cleared at the start of the next one. */
  events: WorldEvent[]
  /** Absolute times at which a new enemy may spawn. */
  enemyRespawns: number[]
  /** Absolute time of the next apple spawn. */
  appleSpawnAt: number
  nextId: number
}
