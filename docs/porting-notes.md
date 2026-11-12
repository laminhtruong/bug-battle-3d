# Porting notes

The original game was a Unity project written early in the author's learning
curve. This rewrite keeps the gameplay and drops the rest. It is not a line by
line port; the rules were re-derived from prefabs, scripts and playtests.

## Kept

- Snake chain that grows by eating and by picking up dropped parts.
- Heads and bodies as combinable parts with their own health, attacks and score.
- Contact damage, projectiles, cone attacks and ground hazards.
- Short rounds in one arena with bots filling empty slots.
- Respawn with the base loadout.

## Dropped

- Ads, in-app purchases and Firebase.
- Doozy UI, DOTween, Jambox SDK.
- Quests, shop, progression, daily rewards and accounts.
- The old map scenes and their zone logic. Only floor visuals and textures are
  reused, on a new single 48 by 48 arena.

## How the rewrite differs

| Unity version                 | This version                                 |
| ----------------------------- | -------------------------------------------- |
| Frame-rate dependent movement | Fixed 30 Hz simulation, variable render      |
| `Random`                      | Seeded `mulberry32`, no `Math.random` in sim |
| Prefab hierarchy per segment  | Segments sampled from the head trail         |
| MonoBehaviour combat          | Data-driven attack descriptors               |
| Photon or direct socket       | Host-authoritative PeerJS data channel       |
| Scene-based maps              | Arena data file                              |

## Deliberate limits

- The host runs the only authoritative simulation. There is no rollback and no
  host migration; if the host leaves, the round ends.
- Guests are untrusted. Input is validated and rate limited, but a host can cheat
  in its own room by design.
- Snapshots send part ids, not definitions. Both sides must agree on the content
  hash before a match starts.
- Part models are static (no animation clips are played) and share one palette
  texture; placeholder primitives show only if a model fails to load.
- The original legs were animated with inverse kinematics. The models ship with
  the legs in their rest pose, so the bodies do not walk yet.

## Where to look

- Rules and balance: `src/data/balance.ts`, `src/content/`.
- Simulation: `src/sim/`.
- Network: `src/net/`.
- Rendering: `src/render/`.
