# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Host-authoritative online play with five character room codes over PeerJS.
- Lobby, guest handshake, content hash check and disconnect-to-bot fallback.
- Wire protocol with zod validation, message size limits and input rate limits.
- Protocol and snapshot tests.
- Part models and the arena floor texture converted from the original Unity art,
  rendered in place of the placeholder primitives.
- Sound effects for apples, pickups, hits, deaths and the result screen, copied
  from the original Unity audio and played from the simulation events.
- Blob shadows under the segments and name labels above the players.
- A dev-only web editor for heads and bodies: part CRUD, stats, model, art
  offset, attack presets and spawn points, undo/redo, a Unity-style view gizmo
  and collider box editing. It reads and writes the same `src/content` JSON
  files the game loads.
- Attack editing from presets (projectile, side projectiles, hazard projectile,
  side hazard projectiles and cone), with add/remove and editable values.
- Projectile and cone attacks take any number of spawn points, each with a
  position and a direction. Spawn points can also move on Y, which sets how high
  shots and the cone are drawn. The editor draws them as handles with X/Y/Z
  arrows so a point can be dragged per axis or edited with X/Y/Z/A fields.
- The editor shows arrows only for the selected object: a spawn point shows its
  muzzle arrows, and clicking the part art switches back to the art arrows.
- Cone attacks draw a 3D cone volume in the editor, so the effect origin,
  direction and reach are visible while authoring.
- A hurt part flashes its emission white twice. The killing hit finishes that
  flash before the part shrinks away and pops the original 12-spark effect, so
  it never vanishes mid-flash. New, restored and respawned parts pop back in
  instead of appearing abruptly.

### Changed

- Cone attacks now store their effect origin in `spawnPoints` too, defaulting to
  the part pivot and forward, so old content keeps its behaviour.
- Projectile attacks now store their muzzles in `spawnPoints` instead of a
  single `mount`. Each point has a raw prefab position and an optional direction
  in degrees, so one part can fire from several places. The simulation rotates
  each point with the part and scales it like the art.
- Head and body definitions now live in JSON files under `src/content/heads` and
  `src/content/bodies`. The game registry and the editor both read them, and the
  editor writes JSON, so content can be authored without touching TypeScript.
- Part collision now uses the trigger BoxColliders authored in the Unity art
  prefabs, scaled with the models, instead of one circle per segment. Long claws
  and sideways spikes hit where the art says they should. Every box is a
  hurtbox; only boxes copied from a `Claw` collider deal contact damage, so the
  gun, fire, lightning and poison heads no longer hurt by touching.
- Collider boxes keep the full Unity BoxCollider centre and size (X/Y/Z) and the
  rotation of the GameObject they hang on, so rotated claws hit where the art
  points. The editor shows RX/RY/RZ next to the centre and size. The simulation
  still tests the XZ plane only, using the rotated centre and the box yaw; Y is
  kept so the editor can draw the box at the same height as the art. The values
  are copied from each prefab's `m_Center`, `m_Size` and transform rotation, so
  the boxes match the art instead of the guessed heights that sat too tall.
- The content hash now covers part stats and colliders, not only part ids, so
  mismatched builds are rejected before a match starts.
- Snapshots carry each segment's `hurtUntil`, so guests see the same hit flash
  as the host. This bumps the wire protocol to version 5.
- The renderer blends between the last two simulation ticks, and guests blend
  between two host snapshots, so movement is smooth on any display refresh rate
  instead of stepping at 30 Hz.
- The rules follow the original game again:
  - the snake only moves while the stick is pushed and stops when it is
    released, a light push moves slower;
  - losing the head is not fatal while a body can still attack, the round only
    ends when no part can attack anymore;
  - a destroyed part keeps its place in the chain and shows its bones, and
    picking up a head brings a lost head back.
- The first body segment sits behind the head instead of inside it, at the
  0.3 distance the original uses between parts.
- Part models use the 0.25 scale and 0.125 lift of the Unity prefabs again, so
  the models match the unit distances of the simulation and their collision
  radii.
- Part models keep the pivot authored in their model file, as the original
  prefabs do, instead of being recentred on their bounding box. Heads with long
  claws or antennae now attach to the chain at the same point as in Unity.
- Destroyed parts show the bones of the original, a skull for the head and a
  small bone for the body, converted from the Unity art.
- Bodies play the leg animation that ships with the source models while the
  snake moves.
- Normal bugs wander and only shoot forward, like the original, instead of
  chasing the player across the arena.
- Sound effects are tagged with the snake they belong to, so a player only hears
  what happens to their own snake. The same effect played again within 150 ms is
  dropped, which keeps combat from turning into noise.
- Wire protocol version 2: the sound list of a snapshot carries the owner id.
- Wire protocol version 3: a snapshot segment carries the destroyed flag.

### Fixed

- The in-game camera now uses the original rig: 10 units above the head, 3.5
  behind it, held at a fixed 75 degree pitch through a 60 degree lens. It used to
  sit at the lower menu-camera angle, which made the arena read much closer.
- The fire, lightning, poison and spike01 bodies show their side spikes and pods
  again. FBX2glTF wrote NaN skin weights for the vertices those source FBX files
  leave unweighted, so the GPU dropped them; they now bind to the root joint.
  `check:assets` rejects NaN or unnormalised skin weights, so a fresh conversion
  cannot lose the same art silently.

## [0.1.0] - 2026-11-12

### Added

- Deterministic 30 Hz arena simulation with seeded RNG.
- One 48 by 48 arena, four player slots, bots fill empty slots, 90 second rounds.
- Eight heads and seven bodies discovered from the content registry and validated
  with zod.
- Contact damage, projectile attacks, fire cones, poison and lightning areas,
  part drops, respawn and score.
- three.js renderer with toon shading, camera follow, keyboard and touch input.
- DOM HUD with menu, lobby, scoreboard, toast and results screens.
- Static build with Vite, strict TypeScript, ESLint, Prettier and Vitest.
- CI checks for lint, types, ASCII and kebab-case file names, assets and tests.

### Known limits

- No host migration and no TURN relay.
- No progression, shop, quests or accounts.
