/** Arena parameters. Adding an arena is a data change, not a code change. */
export interface ArenaDef {
  id: string
  name: string
  width: number
  depth: number
  /** Floor texture key under public/assets. */
  floorTexture: string
  durationSec: number
  /** Destructible power-ups kept on the map. */
  powerupTarget: number
  appleTarget: number
  /** Wandering bugs that live on the map and are refilled while the round runs. */
  enemyCap: number
  enemyHeads: readonly string[]
  enemyBodies: readonly string[]
  /** Seconds between boss spawns, and between a boss death and its replacement. */
  bossEverySec: number
  /** Boss head and body pools. */
  bossHeads: readonly string[]
  bossBodies: readonly string[]
  bossBodyCount: number
}
