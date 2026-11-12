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
