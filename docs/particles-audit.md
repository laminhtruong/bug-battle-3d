# Game particle audit

Compared with the local Unity project on 2026-11-14. These are all effects
currently called by `src/render/prop-view.ts` and `src/render/snake-view.ts`.
Gun bullets are meshes, not particle systems.

| Native preset      | Unity source under `Assets/MainGame/Prefabs`           |       Layers |
| ------------------ | ------------------------------------------------------ | -----------: |
| `flame-head`       | `Heads/Head.prefab`: BulletFire, Smoke, Long           |            3 |
| `flame-body`       | `Bodies/Body.prefab`: BulletFireR/L, Smoke, Long       | 3 per muzzle |
| `lightning-orb`    | `Bullets/BulletLightning.prefab`: OrbGlow, Lightning   |            2 |
| `lightning-impact` | Same prefab: NovaLightningPurple and its four children |            5 |
| `poison-orb`       | `Bullets/BulletPoison.prefab`: OrbGlow                 |            1 |
| `poison-impact`    | `DecalPoison.prefab` and its three children            |            4 |
| `death-explosion`  | Head/Body prefab: BalloonPopExplosion, Sparks, Ring    |            3 |

## Corrections

- Restored start colors, smoke alpha, random poison colors, lifetime gradients,
  rotation over life, and native speed limits. Restored the pink lightning
  ring/glow instead of the incorrect yellow/white combination.
- Put the poison decal on XZ and rotated its emitters upward. Restored the
  missing central lightning flash and corrected the body flame's own settings
  instead of reusing the head flame's settings.
- Preserved Unity's random fixed atlas frames for fire/smoke/poison clouds with
  `IntervalValue` start tiles; they are not lifetime flipbook animations.
- Converted size curves using their Hermite tangents, holding endpoint values
  outside the first/last keys. Lightning flipbook curves wrap within nine tiles.
- Orbs use Unity's world-space simulation: existing particles stay behind when
  the projectile moves. One-shot effects still destroy themselves in runtime;
  editor previews preserve their authored emitters.
- Replaced the handwritten death particles with native Quarks layers and the
  original triangle texture. All 11 FX textures match Unity pixel-for-pixel.

Existing game-unit scale factors are retained: head flame 4, body flame 3,
poison impact 4, lightning impact 1.4, orb glow 2.8, orb lightning 4, death 2.
Unity muzzle placement remains in the part's attack spawn points.

## Native-library differences

- `FrameOverLife` cannot randomly interpolate two Unity animation curves.
  Lightning uses the upper curve, including its start phase and cycle count.
- Quarks' native `LimitSpeedOverLife` damping is not identical to Unity's
  frame-step damping; no custom behavior emulates it.
- Unity mesh glow is approximated by a horizontal billboard. Bloom, smoke
  collision, poison velocity/inherited-velocity modules and stretched-sprite
  pivot offsets are not reproduced exactly.
- Random color generators are preserved on import/save. Their specialized
  values are editable through Native Quarks JSON, not the constant-color input.

The inspector now reads live `ConstantValue`/`IntervalValue` instances rather
than their JSON type names; lifetime, speed, size and emission fields no longer
fall back to misleading defaults.

Checks cover real Quarks parsing, atlas bounds, finite simulated particles,
world-space projectile motion, and cleanup of every runtime effect type.
