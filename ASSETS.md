# Assets

The art, textures and sounds were created by the project author, who has
confirmed the rights to publish them. The particle textures under `textures/fx/`
require the Epic Toon FX license described below; no paid plugin code is
included.

The current build ships the part models as GLB, the apple and power-up props,
plus the floor, palette and FX textures. This document records the file layout,
naming rules, conversion notes and third-party notices.

## Naming rules

- Lowercase kebab-case, ASCII only.
- The file stem is the content id, so `claw01.glb` belongs to `claw01`.
- Head and body ids may repeat (`gun`, `fire`); the folder separates the slots.
- All shipped assets live under `public/assets` and are checked by
  `npm run check:assets`.

## Target layout

```
public/assets/
  models/parts/head/<id>.glb
  models/parts/body/<id>.glb
  models/bones/head.glb
  models/bones/body.glb
  models/props/apple.glb
  models/props/powerup.glb
  textures/parts/bug-atlas.png
  textures/arenas/classic/floor-base.png
  textures/ui/logo.png
  audio/sfx/<name>.mp3
```

The bone models show the remains left when a part explodes: a skull for the head
and a small bone for the body.

Sound effects ship under `audio/sfx/`. Each file is played from a simulation
event and is tagged with the snake it belongs to, so a player only hears the
effects of their own snake.

## FX textures

The fire, lightning and poison particle textures under
`public/assets/textures/fx/` come from the particle materials used by the game.
Most are from the Epic Toon FX pack; `decal-poison.png` is the project author's
own art. These files are not covered by this repository's MIT license. Keep or
redistribute them only if you hold the applicable Epic Toon FX license.

## Models

The models were converted once, keeping only position, normal and the first UV
set. The art files live outside this repository, so the GLBs are committed
instead. `src/render/models.ts` applies the shared palette texture and keeps
each model at its authored size. Props keep a fixed scale and rotation:
`apple` is 0.75 turned 90 degrees, and `powerup` is 0.9, doubled so the crate
still reads at this camera distance. Placeholder primitives stay as a fallback
while a model loads. Do not commit raw model, PSD or package files.

The converter writes NaN weights for vertices that the art file leaves
unweighted, which makes the GPU drop their triangles. This hit the side spikes
and pods of `fire`, `lightning`, `poison` and `spike01`; those vertices are bound
to the root joint with weight 1, which keeps them in the bind pose.
`npm run check:assets` rejects NaN or unnormalised skin weights, so a future
conversion that drops them fails the check instead of losing art.

## Third-party notices

- three.js, MIT.
- PeerJS, MIT.
- No paid asset packs are included.
