/**
 * Gameplay balance. Tuning happens here, not in the simulation code.
 */
export const BALANCE = {
  tickRate: 30,
  maxPlayers: 4,
  playerSpeed: 12,
  bossSpeed: 12.5,
  enemySpeed: 8.8,
  /** Radians per second. High enough to feel direct, low enough to avoid snapping. */
  turnRate: 16,
  bodySpacing: 1.2,
  /** Distance between a part and the one in front of it. */
  headSpacing: 1.2,
  maxSegments: 48,
  /** Keeps the snake centre away from the arena wall. */
  edgeMargin: 1.8,
  projectileRadius: 0.72,
  hurtCooldownSec: 0.25,
  respawnDelaySec: 3,
  /** The boss attacks a little slower than a player, but carries many parts. */
  bossCooldownScale: 1.2,
  /** Wandering bugs attack slower than players. */
  enemyCooldownScale: 1.5,
  /** Bots roll gear this much stronger than the best part the human owns. */
  botGearBonus: 10,
  food: {
    /** Head plus three normal bodies. */
    startSegments: 4,
    applesToGrow: 2,
    growthStep: 2,
    scorePerApple: 5,
  },
  drops: {
    /** Every part of a dead bug rolls this, so longer bugs drop more. */
    partChance: 0.5,
    healChance: 0.5,
    ttlSec: 20,
  },
  pickupRadius: 2.8,
  /** A player never appears closer than this to another living player. */
  playerSpawnMinDistance: 24,
  /** Destructible power-ups scattered around the map. */
  powerupHpMin: 5,
  powerupHpMax: 10,
  /** A broken crate throws this many items out around it. */
  powerupDropCountMin: 3,
  powerupDropCountMax: 5,
  /** Items land this far from the broken crate. */
  powerupDropMinDistance: 2,
  powerupDropMaxDistance: 5,
  /** Loot arcs up for this long before it can be picked up. */
  powerupDropFlightSec: 0.8,
  powerupDropHeight: 6,
  /** Crate centres keep this much space between them. */
  powerupSpacing: 18,
  /** A head stops this far from a power-up centre, so the crate is solid. */
  powerupSolidRadius: 1.9,
  powerupDropHeadChance: 0.3,
  powerupRespawnSec: 5,
  powerupSpawnMinDistance: 24,
  /** Boss loot: its head plus nine of its ten bodies. */
  bossLootCount: 10,
  bossSpawnMinDistance: 48,
  /** Wanderers refill one at a time, this long apart. */
  enemyRespawnSec: 2,
  enemySpawnMinDistance: 32,
  appleRespawnSec: 0.8,
  roundSec: 90,
  leaderboardSize: 4,
  /** Host snapshots per second. Guests blend between two of them. */
  snapshotRate: 15,
} as const
