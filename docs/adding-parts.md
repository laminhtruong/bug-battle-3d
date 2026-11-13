# Adding a head or a body

A part is pure data. Adding one means adding one JSON file; the registry discovers
it, validates it with zod and hashes it for network compatibility.

## Using the editor

`npm run editor` starts Vite and opens `/editor.html`. The editor works on the
same files described below: it lists heads and bodies, lets you add and delete
parts, edit their stats and model, author attacks, and align the art with the
body chain. The collider boxes are hidden by default: tick **Edit** in the Colliders section to
show and change them, or drag the X/Z arrows on the selected part or type X/Z in
its position fields to move the art offset. Y is fixed by the part lift. The
body reference is always shown for heads. The view gizmo snaps the camera to the
nearest axis, `W`/`R` switch tools, and `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo
edits. It validates before writing, so a bad save never leaves the content
registry broken.

The editor is a dev tool. It is not part of the production build and needs the
Vite dev server for its file API.

## Steps

1. Create `src/content/heads/my-head.json` or `src/content/bodies/my-body.json`.
2. Write an object that matches the schema below.
3. Give it a unique kebab-case id within its slot.
4. Run `npm run check`.

```json
{
  "id": "my-body",
  "name": "My Body",
  "hp": 2,
  "score": 5,
  "contact": { "damage": 0 },
  "boxes": [{ "center": [0, -0.1, -0.05], "size": [1.5, 1.45, 1.15] }],
  "attack": {
    "kind": "projectile",
    "cooldown": 1.4,
    "projectile": {
      "speed": 12,
      "ttl": 1.2,
      "visual": "bullet",
      "spawnPoints": [{ "x": 0, "z": 1.96 }]
    }
  }
}
```

## Rules

- `id` must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Head and body ids may repeat. `head:gun` and `body:gun` are different parts.
- The slot comes from the folder (`heads` or `bodies`), never from the file.
- `boxes` is required and must contain at least one trigger box. It is the
  part's hit shape; there is no fallback circle.
- `attack` is optional. Parts without an attack only deal contact damage through
  their `hitbox` boxes.
- `offset` is optional and defaults to `[0, 0]`. It shifts the art only, in raw
  art units, so a head can line up with the body chain without moving its
  colliders. Drag the X/Z arrows in the editor or type X/Z into the position
  fields; Y is fixed by the part lift.
- Attacks are data, not functions. The simulation interprets them; do not import
  three.js, the DOM or `Math.random`.
- `score` is what a killer earns for destroying this part.
- `visual` is a string key used by the renderer, not a texture path.

## Colliders

Each part carries trigger boxes that define its hit shape. The editor is the
primary way to author them: tick **Edit**, then drag a box over the art, edit its
centre and size, and mark the boxes that should deal contact damage.

- `center` and `size` are in raw art units. Models render at their authored size,
  so these are arena units and the boxes line up with the model.
- `center` is relative to the part pivot. Local `+z` points forward, the same
  direction the model faces.
- `rotation` is the box rotation in degrees, ZXY order. Both the centre and the
  box axes turn around the part pivot. Leave it out for no rotation.
- Every box is a hurtbox, so projectiles and other claws can damage any of them.
  Add `"hitbox": true` to boxes that also deal contact damage, using the part's
  `contact.damage`.

For the spike body, the main body plus a rotated claw looks like this:

```json
"boxes": [
  { "center": [0, 0, -0.05], "size": [1.5, 0.9, 1.15] },
  { "center": [4.1, 0.25, 1.38], "size": [1.5, 0.25, 0.6], "rotation": [0, 20, 0], "hitbox": true }
]
```

The simulation runs on the XZ plane, so collision uses the rotated centre and
the box yaw. X/Z tilt barely changes the footprint and is ignored there, but the
editor still draws the box with the full rotation. Y is kept so the box sits at
the same height as the art; the editor adds the 0.5 part lift when it draws the
box.

That is why a gun head has `"contact": { "damage": 0 }`: it has only a body box,
while every claw head has claw boxes.

If a part has no authored boxes yet, start from a box that covers the visible
model. The box may be smaller than the art, but it must not be empty.

## Attacks

The editor authors attacks from presets: **Projectile**, **Side projectiles**,
**Hazard projectile**, **Side hazard projectiles** and **Cone**. Pick one in the
Attack section to add an attack; pick **No attack** to remove it. The preset only
fills sensible defaults, so every value stays editable afterwards.

A projectile and a cone can have any number of spawn points. They are drawn in
the 3D view as orange handles. Click a point to select it: its orange X/Y/Z
arrows and a green Y rotation ring appear, and dragging a point, an arrow or the
ring moves or turns it. The X/Y/Z/RY fields do the same. RY is the rotation
around Y in degrees relative to the part facing: `0` is forward, `90` is right
and `-90` is left. Add or remove points with **+ point** and the row's delete
button. Clicking the part art selects the part itself and shows its art-offset
arrows instead. For a cone the spawn point is where the effect starts, and the
editor draws the 3D cone volume so its direction and reach are easy to see.

```json
"attack": {
  "kind": "projectile",
  "cooldown": 1,
  "projectile": {
    "speed": 14,
    "ttl": 1.1,
    "visual": "poison",
    "damage": 1,
    "spawnPoints": [
      { "x": 0, "z": 1.96 },
      { "x": 1.96, "z": 0, "angle": 90 }
    ],
    "onLand": { "delay": 0.1, "duration": 4, "radius": 1.6 }
  }
}
```

Spawn points are raw art units, like `boxes` and `offset`. The game uses them
as arena units and rotates them with the part. `y` defaults to `2`,
the height shots used before spawn points existed, and only changes presentation:
the simulation still runs on the XZ plane. Omit `y` when it is `2`, `angle` when
it is zero and `damage` when it is `1`; the schema supplies those defaults.
`onLand` is optional and turns the shot into a delayed area hazard. `visual` is
one of `bullet`, `poison` or `lightning`. `interval` sets the seconds between
damage ticks; omit it to damage as often as the hurt cooldown allows.

An immediate cone hit: `damage` is fixed at 1 for cones. The optional
`spawnPoints` move the cone origin; without them it starts at the part pivot and
faces forward.

```json
"attack": {
  "kind": "cone",
  "cooldown": 0.9,
  "cone": {
    "range": 2.2,
    "halfAngleDeg": 45,
    "duration": 0.3,
    "spawnPoints": [{ "x": 0, "z": 1.96 }]
  }
}
```

## Models

The part file can carry a `model` key; it defaults to the part id. The asset check
expects `models/parts/head/<model>.glb` or `models/parts/body/<model>.glb`. A part
without a model file still plays; the renderer falls back to a colored primitive.

`src/render/models.ts` loads every registered model in the background. It keeps
the pivot authored in the model file, drops the arbitrary offset of the exported
scene, then applies the 0.5 part lift. The `boxes` values use the same units, so
the collider and the art share one pivot. Body
models are skinned, so they are copied with `SkeletonUtils.clone`; a plain
`clone` would leave them bound to the template bones and they would never draw
under the snake. Models must keep their first UV set: the parts share one
palette texture and take their colors from it.

## Balance

Gameplay constants live in `src/data/balance.ts`. A part file should only hold
numbers that are specific to that part.
