# Bug Battle 3D

A browser snake arena game built with three.js and TypeScript.

Grow your bug by eating apples and breaking power-ups, fight wandering bugs, and
take down the boss that arrives every 30 seconds. One 90 second round, up to four
players online; local play fills the empty slots with bots.

- **Local play** against three bots.
- **Online play** with a five character room code. The host runs the simulation.
- **Deterministic simulation** at a fixed 30 Hz, independent of rendering.
- **Data-driven parts**: a new head or body is one file, no engine changes.
- **Keyboard and touch** controls, no UI framework.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL. `npm run build` produces a static site in `dist/` that
can be deployed to GitHub Pages, Netlify or any static host.

## Controls

| Action | Desktop            | Touch                    |
| ------ | ------------------ | ------------------------ |
| Move   | WASD or arrow keys | Drag the on-screen stick |

The snake moves while the stick is pushed and stops when it is released. A
light push moves slower.

## Online play

1. One player clicks **Create room** and shares the five character code.
2. Everyone else types the code and clicks **Join**.
3. The host clicks **Start match**. Only joined players play; online matches
   have no bots.

There is no game server. The host owns the authoritative simulation and sends
15 snapshots per second; guests send input at 30 Hz. WebRTC signaling uses the
public PeerJS broker.

Known limits, by design:

- No host migration. If the host leaves, the match ends.
- No bots online. A dropped player leaves the arena instead of being taken over.
- No TURN relay. A small fraction of symmetric NAT pairs will not connect.
- No server-side anti-cheat. The host can trivially cheat in its own room.

## Scripts

| Script              | Description                                |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Start the Vite dev server                  |
| `npm run build`     | Type-check and build the static site       |
| `npm run preview`   | Preview the production build               |
| `npm run test`      | Run the Vitest suite                       |
| `npm run lint`      | Run ESLint                                 |
| `npm run typecheck` | Run TypeScript in no-emit mode             |
| `npm run check`     | Lint, type-check, content checks and tests |

## Architecture

```
src/
  core/      fixed timestep loop, seeded rng, 2D math
  sim/       deterministic world simulation (no three.js, no DOM)
  content/   heads, bodies, arenas, auto-discovered registry
  render/    three.js scene, snake and prop views
  net/       protocol, PeerJS adapter, host and guest sessions
  ui/        DOM HUD, keyboard and touch joystick
  data/      gameplay balance constants
tests/       unit tests for the simulation, content and protocol
```

Rules that keep the project maintainable:

- `src/sim`, `src/content` and `src/data` never import three.js or touch the DOM.
- `Math.random` is banned there; everything derives from a seeded RNG.
- Network input is untrusted: it is parsed, range checked and rate limited.
- Part ids are strings on the wire; content hashes must match before a match starts.

## Editing content

Run `npm run editor` and open the page it launches. It is a dev-only web editor
for heads and bodies: add, delete, or edit a part, change its stats and model,
author attacks from presets, and align the art on the pivot with the X/Z arrows
or the X/Z fields. Y is locked to the part lift. Attack spawn points appear as
orange handles. Click a point to show its orange X/Y/Z arrows and green Y ring:
drag a point, an arrow or the ring to place and turn each muzzle, or edit
X/Y/Z/RY in the panel. Clicking the art shows the part's own arrows instead. For
cone attacks the editor also draws the 3D cone volume, so its origin, direction
and reach are easy to picture. Collider boxes stay hidden until you tick
**Edit** in the Colliders section,
where you can set their centre, size and rotation. The axis widget snaps the
camera to the nearest axis, and undo/redo is available with `Ctrl+Z` /
`Ctrl+Shift+Z`. It reads and writes the same `src/content` JSON files the game
loads, so `npm run check` still validates everything afterwards.

Run `npm run editor:particles` to open Quarks Studio. It edits native Three.js
`Object3D.toJSON()` documents containing Quarks `ParticleEmitter`s, previews them
with `QuarksLoader`, and supports layered systems, live parameters, curves,
textures, import/export, and undo/redo. Bundled effects live in
`src/content/particles`; editor changes are stored as native JSON overrides in
`src/content/particle-overrides`. Saved ids can be used as projectile visuals.

## Adding content

A head or a body is a single JSON file under `src/content/heads` or
`src/content/bodies`. The registry discovers it automatically and validates it
with zod. Its `boxes` are trigger boxes that define its hit shape, so collision
follows the shape of the art. See [docs/adding-parts.md](docs/adding-parts.md).

## Assets

The art belongs to the project author and ships with the game as GLB models, PNG
textures and MP3 sound effects. The renderer falls back to placeholder
primitives while a model loads. File naming rules, model requirements and
third-party notices are documented in [ASSETS.md](ASSETS.md).

## Status

Early playable version (`0.1.0`):

- One arena, up to four players, 90 second rounds; local play adds bots.
- You start with a head and three normal bodies; bots roll a random head and
  three random bodies whose strength follows the best part you own.
- Eight wandering bugs roam the map at random and are replaced a couple of
  seconds after they die.
- Bots forage apples and power-ups, break off for a short chase when the human
  comes close, then go back to foraging. They close to bite or shoot range and
  hold there instead of running through the target. Only a bot whose head shoots
  farms crates; melee bots leave them alone. They still trade hits with rival
  bots, but never chase them. They see a moving player through a short reaction
  delay, so a quick turn can shake them off. The boss roams until a player comes
  close, then keeps chasing from a longer range.
- Twenty apples spawn around the arena and refill during the round.
- Sixteen destructible power-ups sit around the arena with 5 to 10 health, kept
  apart from each other. Breaking one throws three to five items up around it;
  they land after a short arc and can only be picked up once down. Each item is
  a head 30% of the time and a body otherwise.
- A boss with a strong head and ten mixed bodies appears every 30 seconds and
  returns 30 seconds after it dies, dropping ten of its own parts.
- Core combat: contact damage, projectile heads and bodies, fire cones, poison and
  lightning areas.
- Respawn after three seconds at a fresh random arena spot, with the default
  build again: one head and three normal bodies. Bots keep their random gear
  rolls. Score from apples and destroyed parts.
- Online play and local play share the same simulation.

Not included: campaign, quests, shop, progression, accounts, leaderboards.

## License

MIT. See [LICENSE](LICENSE). Third-party asset notices are listed in
[ASSETS.md](ASSETS.md).
