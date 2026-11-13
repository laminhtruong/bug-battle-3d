/**
 * Gameplay balance. Values are adapted from the original Unity project so the
 * feel stays close; tuning happens here, not in the simulation code.
 */
export const BALANCE = {
  tickRate: 30,
  maxPlayers: 4,
  playerSpeed: 3,
  enemySpeed: 2.2,
  /** Radians per second. High enough to feel direct, low enough to avoid snapping. */
  turnRate: 16,
  bodySpacing: 0.3,
  /** Same distance the original uses between a part and the one in front of it. */
  headSpacing: 0.3,
  maxSegments: 48,
  /** Keeps the snake centre away from the arena wall, like the original NavMesh. */
  edgeMargin: 0.45,
  projectileRadius: 0.18,
  /** Distance in front of the part where a shot appears. */
  projectileSpawnOffset: 0.49,
  hurtCooldownSec: 0.25,
  respawnDelaySec: 3,
  /** Enemy attacks are slower than player attacks, as in the original. */
  enemyCooldownScale: 1.5,
  food: {
    startSegments: 2,
    applesToGrow: 2,
    growthStep: 2,
    scorePerApple: 5,
  },
  drops: {
    headChance: 0.15,
    bodyChance: 0.3,
    healChance: 0.5,
    applesMin: 3,
    applesMax: 5,
    ttlSec: 20,
  },
  pickupRadius: 0.7,
  enemySpawnMinDistance: 8,
  enemyRespawnSec: 1.5,
  appleRespawnSec: 0.8,
  roundSec: 90,
  leaderboardSize: 4,
  /** Host snapshots per second. Guests blend between two of them. */
  snapshotRate: 15,
} as const
