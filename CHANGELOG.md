# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Arena redesign: every bug starts with a head and three normal bodies, sixteen
  destructible power-ups with 5 to 10 health sit around the map, and a boss with
  a strong head and ten varied bodies spawns every 30 seconds.
- Eight wandering bugs roam the map at random. They shoot forward but never
  chase, and they respawn a couple of seconds after they die. Apples keep
  spawning randomly around the arena.
- Bots roll a random head and three random bodies whose part score stays close
  to the best part the human owns. They forage apples and power-ups, chase a
  nearby player for a short run, then rest before chasing again.
- Bots get random English names instead of "Bot 2", and both bots and the boss
  show a name tag over their head.
- The apple and power-up targets now use real models with the shared bug
  palette, instead of placeholder primitives.
- A destroyed power-up throws three to five items up and out around it. They
  arc down over a short moment, and cannot be picked up until they land, so a
  player can step back from an unwanted head. Each item is a head 30% of the
  time, otherwise a body. Crates keep their distance from each other, so two
  boxes never share a corner. A dead boss drops exactly ten of its own parts,
  including its head, and comes back 30 seconds later.
- Boss AI leads its target, weaves to a flank while its attack reloads and lines
  up when ready. It roams the map until a player comes close, then chases from a
  longer range than a bot; it never goes after pickups or power-ups.
- Players no longer appear on four fixed corners: every spawn and respawn picks
  a random arena point, kept away from other players, crates and loose loot.
  A human respawn also resets the build to the default head and three normal
  bodies, so gear picked up during a life does not survive a death. Bots keep
  rolling their random gear on respawn.
- Bots hunt part drops, power-ups and apples in range, and chase the human for a
  short run before resting. They read a moving target through a short reaction
  delay, so a sudden turn is not mirrored on the spot. They close to bite or
  shoot range and hold there instead of running through the target, so their
  body no longer coils around the player's head. They still run when the human
  comes close. Only a head that shoots farms crates: melee bots leave the solid
  boxes alone. A crate the human is standing next to is skipped, and rival bots
  are never chased. Rival bots still take contact and projectile hits.
- A snake whose head is destroyed only has bones at the front, but it keeps
  fighting while a surviving body can still bite or shoot.
- Power-ups are solid: a snake head stops at the crate and slides around it
  instead of passing through.
- Host-authoritative online play with five character room codes over PeerJS.
- Lobby, guest handshake, content hash check and disconnect-to-bot fallback.
- Wire protocol with zod validation, message size limits and input rate limits.
- Protocol and snapshot tests.
- Part models and the arena floor texture, rendered in place of the placeholder
  primitives.
- Sound effects for apples, pickups, hits, deaths and the result screen, played
  from the simulation events.
- Blob shadows under the segments and name labels above the players.
- A dev-only web editor for heads and bodies: part CRUD, stats, model, art
  offset, attack presets and spawn points, undo/redo, an axis view gizmo
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
- A hurt part flashes its emission white once per hit. The killing hit finishes
  that flash before the part shrinks away and pops the 12-spark effect,
  so it never vanishes mid-flash. New, restored and respawned parts pop back in
  instead of appearing abruptly.
- Legs play the walk cycle, trimmed to its repeating part so the loop has
  no snap, at double speed.
- A dying snake flashes white on the killing hit, then shrinks into its bones and
  leaves them on the floor for a moment before vanishing.

### Changed

- Spawn points carry a Y rotation that can be dragged with the editor's green
  ring or typed as RY, and the fire head and body now take their mounts from the
  part JSON instead of hardcoded offsets, so the flames, the cone and the damage
  all start at the same points.
- Fire, lightning, poison and bullet visuals now use `three.quarks`: head and
  body flames ride the part they belong to, lightning lands with its ring, glow,
  shards and flat ground bolts, poison leaves its decal, cloud and skull, and
  shots use their colours and radii. The snapshot also carries each segment's
  attack cooldown, which the flames use as their trigger.
- Cone attacks now store their effect origin in `spawnPoints` too, defaulting to
  the part pivot and forward, so old content keeps its behaviour.
- Projectile attacks now store their muzzles in `spawnPoints` instead of a
  single `mount`. Each point has a raw local position and an optional direction
  in degrees, so one part can fire from several places. The simulation rotates
  each point with the part, in the same units as the art.
- Head and body definitions now live in JSON files under `src/content/heads` and
  `src/content/bodies`. The game registry and the editor both read them, and the
  editor writes JSON, so content can be authored without touching TypeScript.
- Part collision now uses trigger boxes authored with the art, in the same units
  as the models, instead of one circle per segment. Long claws and sideways
  spikes hit where the art says they should. Every box is a hurtbox; only boxes
  marked as hitboxes deal contact damage, so the gun, fire, lightning and poison
  heads no longer hurt by touching.
- Collider boxes keep the full centre and size (X/Y/Z) and their rotation, so
  rotated claws hit where the art points. The editor shows RX/RY/RZ next to the
  centre and size. The simulation still tests the XZ plane only, using the
  rotated centre and the box yaw; Y is kept so the editor can draw the box at
  the same height as the art. The boxes match the art instead of the guessed
  heights that sat too tall.
- The content hash now covers part stats and colliders, not only part ids, so
  mismatched builds are rejected before a match starts.
- Snapshots carry each segment's `hurtUntil`, so guests see the same hit flash
  as the host. This bumped the wire protocol to version 5.
- Snapshots also carry the new `powerup` and `boss` snake controls, so the wire
  protocol is now version 6.
- Wandering bugs use the `enemy` control again, so the wire protocol is now
  version 7.
- The renderer blends between the last two simulation ticks, and guests blend
  between two host snapshots, so movement is smooth on any display refresh rate
  instead of stepping at 30 Hz.
- The rules now match the intended design:
  - the snake only moves while the stick is pushed and stops when it is
    released, a light push moves slower;
  - losing the head is not fatal while a body can still attack, the round only
    ends when no part can attack anymore;
  - a destroyed part keeps its place in the chain and shows its bones, and
    picking up a head brings a lost head back.
- The first body segment sits behind the head instead of inside it, using the
  standard spacing between parts.
- Parts render at the size they are authored at instead of being scaled down by
  four. Colliders, muzzles and offsets use the same units, so they still line up
  with the art. Chain spacing, walk speed and attack ranges were scaled to
  match, and the camera sits four times higher and farther so a native part
  keeps its on-screen size. The floor and the arena now show at their true
  proportion to the bugs.
- Part models keep the pivot authored in their model file instead of being
  recentred on their bounding box. Heads with long claws or antennae now attach
  to the chain at the same point as the art.
- Destroyed parts show bones, a skull for the head and a small bone for the
  body.
- Bodies play their leg animation while the snake moves.
- Normal bugs wander and only shoot forward, instead of chasing the player
  across the arena.
- Sound effects are tagged with the snake they belong to, so a player only hears
  what happens to their own snake. The same effect played again within 150 ms is
  dropped, which keeps combat from turning into noise.
- Wire protocol version 2: the sound list of a snapshot carries the owner id.
- Wire protocol version 3: a snapshot segment carries the destroyed flag.

### Fixed

- A poison or lightning shot now bursts on the first part it touches, so the
  puddle or bolt lands on a power-up instead of flying through it and landing
  behind. A poison bug can break a crate again.
- Bots steer around a power-up that sits between them and their target, so a
  bug walking to loot past a crate no longer parks against the solid box.
- The in-game camera now sits 10 units above the head and 3.5 behind it, held at
  a fixed 75 degree pitch through a 60 degree lens. It used to sit at the lower
  menu-camera angle, which made the arena read much closer.
- Power-ups keep their authored facing instead of a random one, so every crate
  shows the same side.
- The fire, lightning, poison and spike01 bodies show their side spikes and pods
  again. The converter wrote NaN skin weights for unweighted vertices, so the
  GPU dropped them; they now bind to the root joint.
  `check:assets` rejects NaN or unnormalised skin weights, so a fresh conversion
  cannot lose the same art silently.

## [0.1.0] - 2026-11-12

### Added

- Deterministic 30 Hz arena simulation with seeded RNG.
- One 192 by 192 arena, four player slots, bots fill empty slots, 90 second rounds.
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
