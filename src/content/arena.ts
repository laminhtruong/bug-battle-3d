/** Arena parameters. Adding an arena is a data change, not a code change. */
export interface ArenaDef {
  id: string
  name: string
  width: number
  depth: number
  /** Fixed player spawn points, in world units. */
  spawns: readonly { x: number; z: number }[]
  /** Floor texture key under public/assets. */
  floorTexture: string
  durationSec: number
  /** Destructible power-ups kept on the map. */
  powerupTarget: number
  appleTarget: number
  /** Seconds between boss spawns, and between a boss death and its replacement. */
  bossEverySec: number
  /** Boss head and body pools. */
  bossHeads: readonly string[]
  bossBodies: readonly string[]
  bossBodyCount: number
}
