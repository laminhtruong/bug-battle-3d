# Assets

The Unity project this game is ported from ships original art created by the
project author. The author has confirmed the rights to publish it. No paid Unity
plugin code or asset is copied into this repository.

The current build runs on placeholder primitives. This document records what the
art is, where it comes from and how it will be published.

## Naming rules

- Lowercase kebab-case, ASCII only.
- The file stem is the content id, so `head_01` becomes `claw01`.
- Head and body ids may repeat (`gun`, `fire`); the folder separates the slots.
- All shipped assets live under `public/assets` and are checked by
  `npm run check:assets`.

## Target layout

```
public/assets/
  models/parts/head/<id>.glb
  models/parts/body/<id>.glb
  textures/parts/bug-atlas.webp
  textures/arenas/classic/floor-base.webp
  textures/arenas/classic/floor-accent.webp
  textures/arenas/classic/floor-decor.webp
  textures/props/palette.webp
  audio/sfx/eat-apple.mp3
  audio/sfx/power-up.mp3
  audio/sfx/click.mp3
  audio/sfx/bite.mp3
  audio/sfx/pop.mp3
  audio/sfx/win.mp3
  audio/sfx/lose.mp3
```

## Rename map

Verified from the Unity prefabs to their mesh GUIDs.

| Original  | Published id | Slot |
| --------- | ------------ | ---- |
| `head_01` | `claw01`     | head |
| `head_02` | `gun`        | head |
| `head_03` | `claw02`     | head |
| `head_04` | `claw03`     | head |
| `head_05` | `claw04`     | head |
| `head_08` | `fire`       | head |
| `head_09` | `poison`     | head |
| `head_10` | `lightning`  | head |
| `body_01` | `normal`     | body |
| `body_02` | `spike01`    | body |
| `body_03` | `gun`        | body |
| `body_04` | `spike02`    | body |
| `body_08` | `fire`       | body |
| `body_09` | `poison`     | body |
| `body_10` | `lightning`  | body |

| Original texture | Target                                      |
| ---------------- | ------------------------------------------- |
| `bug.png`        | `textures/parts/bug-atlas.webp`             |
| `floor01a`       | `textures/arenas/classic/floor-base.webp`   |
| `floor01b`       | `textures/arenas/classic/floor-accent.webp` |
| `floor01_decor`  | `textures/arenas/classic/floor-decor.webp`  |
| `Colors.png`     | `textures/props/palette.webp`               |

## Conversion pipeline (pending)

Blender is not installed on the development machine, so conversion is not part
of the build yet. When it is available:

1. Import each source FBX and export GLB with `+Y up`, applied transforms and no
   cameras or lights.
2. Bake textures to WebP at the smallest size that stays sharp; keep the atlas
   for parts instead of one texture per part.
3. Encode sound effects to MP3 at 96 kbps mono.
4. Drop files into the target layout above.
5. Run `npm run check` and confirm every model is referenced by a part file.

Until then the renderer keeps using primitives. Do not commit raw FBX, PSD or
Unity package files.

## Third-party notices

- three.js, MIT.
- PeerJS, MIT.
- No paid asset packs are included.
