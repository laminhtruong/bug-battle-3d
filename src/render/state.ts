import type { PickupKind, SnakeControl } from '@/sim/types'
import type { Slot } from '@/content/define'

export interface RenderSegment {
  partId: string
  slot: Slot
  /** Destroyed parts keep their place in the chain. */
  dead: boolean
  x: number
  z: number
  angle: number
  /** Absolute time until which the part flashes from the last hit. */
  hurtUntil: number
}

export interface RenderSnake {
  id: string
  name: string
  control: SnakeControl
  slot: number
  alive: boolean
  score: number
  segments: RenderSegment[]
}

export interface RenderProjectile {
  id: string
  visual: string
  x: number
  y: number
  z: number
}

export interface RenderArea {
  id: string
  partId: string
  x: number
  z: number
  radius: number
}

export interface RenderPickup {
  id: string
  kind: PickupKind
  partId?: string
  x: number
  z: number
  /** Crate loot arcs in from the crate until `landAt`. */
  fromX?: number
  fromZ?: number
  landAt?: number
}

/** Everything the view needs. The simulated World and a network snapshot both fit. */
export interface RenderState {
  time: number
  duration: number
  ended: boolean
  snakes: RenderSnake[]
  projectiles: RenderProjectile[]
  areas: RenderArea[]
  pickups: RenderPickup[]
}
