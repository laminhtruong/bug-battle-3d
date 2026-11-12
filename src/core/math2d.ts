/** Minimal 2D helpers. The world is played on the XZ plane, so y is dropped. */
export interface Vec2 {
  x: number
  z: number
}

export const vec2 = (x: number, z: number): Vec2 => ({ x, z })

export const TAU = Math.PI * 2

export function length(x: number, z: number): number {
  return Math.hypot(x, z)
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function normalize(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z)
  if (len < 1e-6) {
    return { x: 0, z: 0 }
  }
  return { x: x / len, z: z / len }
}

/** Angle for a direction where +z is 0 and +x is PI/2. */
export function angleFromDirection(x: number, z: number): number {
  return Math.atan2(x, z)
}

export function directionFromAngle(angle: number): Vec2 {
  return { x: Math.sin(angle), z: Math.cos(angle) }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU
  if (delta > Math.PI) {
    delta -= TAU
  }
  if (delta < -Math.PI) {
    delta += TAU
  }
  return delta
}
