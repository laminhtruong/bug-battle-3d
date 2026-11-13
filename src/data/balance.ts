/**
 * Gameplay balance. Values are adapted from the original Unity project so the
 * feel stays close; tuning happens here, not in the simulation code.
 */
export const BALANCE = {
  tickRate: 30,
  maxPlayers: 4,
  playerSpeed: 12,
  enemySpeed: 8.8,
  /** Radians per second. High enough to feel direct, low enough to avoid snapping. */
  turnRate: 16,
  bodySpacing: 1.2,
  /** Same distance the original uses between a part and the one in front of it. */
  headSpacing: 1.2,
  maxSegments: 48,
  /** Keeps the snake centre away from the arena wall, like the original NavMesh. */
  edgeMargin: 1.8,
  projectileRadius: 0.72,
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
  pickupRadius: 2.8,
  enemySpawnMinDistance: 32,
  enemyRespawnSec: 1.5,
  appleRespawnSec: 0.8,
  roundSec: 90,
  leaderboardSize: 4,
  /** Host snapshots per second. Guests blend between two of them. */
  snapshotRate: 15,
} as const
