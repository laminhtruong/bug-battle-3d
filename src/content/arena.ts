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
  enemyCap: number
  appleTarget: number
  /** Part ids used to build wandering enemies. */
  enemyHeads: readonly string[]
  enemyBodies: readonly string[]
}
