# Assets

The Unity project this game is ported from ships original art created by the
project author. The author has confirmed the rights to publish it. No paid Unity
plugin code or asset is copied into this repository.

The current build ships the original part models as GLB plus the floor and palette
textures. This document records what the art is, where it comes from and how it
was converted.

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
  textures/parts/bug-atlas.png
  textures/arenas/classic/floor-base.png
```

Sound effects are planned under `audio/sfx/` but are not shipped yet.

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

| Original texture | Target                                   |
| ---------------- | ---------------------------------------- |
| `bug.png`        | `textures/parts/bug-atlas.png`           |
| `floor02a`       | `textures/arenas/classic/floor-base.png` |

## Conversion

The part models were converted once from the Unity FBX sources with
[FBX2glTF](https://github.com/facebookincubator/FBX2glTF) 0.9.7 (BSD-3-Clause),
keeping only position, normal and the first UV set:

```sh
FBX2glTF -b -k position -k normal -k uv0 -o public/assets/models/parts/head/claw01.glb head_01.fbx
```

The FBX files live outside this repository, so the GLBs are committed instead.
`src/render/models.ts` recenters each model, applies the shared palette texture
and scales it to arena units; the source scenes place the parts far from the
origin at a much larger scale. Placeholder primitives stay as a fallback while a
model loads. Do not commit raw FBX, PSD or Unity package files.

## Third-party notices

- three.js, MIT.
- PeerJS, MIT.
- No paid asset packs are included.
