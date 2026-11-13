# Bug Battle 3D

A browser remake of a small Unity snake arena game, rebuilt with three.js and TypeScript.

Grow your bug by eating apples, collect heads and bodies from fallen enemies, and
outlast the swarm. One 90 second round, up to four players, bots fill empty slots.

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

The snake moves while the stick is pushed and stops when it is released, like
the original game. A light push moves slower.

## Online play

1. One player clicks **Create room** and shares the five character code.
2. Everyone else types the code and clicks **Join**.
3. The host clicks **Start match**. Empty slots are filled with bots.

There is no game server. The host owns the authoritative simulation and sends
15 snapshots per second; guests send input at 30 Hz. WebRTC signaling uses the
public PeerJS broker.

Known limits, by design:

- No host migration. If the host leaves, the match ends.
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
and align the art on the pivot with the X/Z arrows or the X/Z fields. Y is
locked to the prefab lift. Collider boxes stay hidden until you tick **Edit** in
the Colliders section. The axis widget snaps the camera like Unity, and undo/redo
is available with `Ctrl+Z` / `Ctrl+Shift+Z`. It writes the same `src/content`
TypeScript files the game loads, so `npm run check` still validates everything
afterwards.

## Adding content

A head or a body is a single file under `src/content/heads` or
`src/content/bodies`. The registry discovers it automatically and validates it
with zod. Its `boxes` are the trigger BoxColliders copied from the Unity prefab,
so collision keeps the original claw and body shapes. See
[docs/adding-parts.md](docs/adding-parts.md).

## Assets

The original Unity art belongs to the project author and ships with the game as
converted GLB models, PNG textures and MP3 sound effects. The renderer falls
back to placeholder primitives while a model loads. File naming rules, the
source rename map and the conversion steps are documented in
[ASSETS.md](ASSETS.md).

## Status

Early playable version (`0.1.0`):

- One arena, four players plus bots, 90 second rounds.
- Core combat: contact damage, projectile heads and bodies, fire cones, poison and
  lightning areas.
- Respawn after three seconds, score from apples and destroyed parts.
- Online play and local play share the same simulation.

Not included: campaign, quests, shop, progression, accounts, leaderboards.

## License

MIT. See [LICENSE](LICENSE). Third-party asset notices are listed in
[ASSETS.md](ASSETS.md).
