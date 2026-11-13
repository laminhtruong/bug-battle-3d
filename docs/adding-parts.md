# Adding a head or a body

A part is pure data. Adding one means adding one JSON file; the registry discovers
it, validates it with zod and hashes it for network compatibility.

## Using the editor

`npm run editor` starts Vite and opens `/editor.html`. The editor works on the
same files described below: it lists heads and bodies, lets you add and delete
parts, edit their stats and model, and align the art with the body chain. The
collider boxes are hidden by default: tick **Edit** in the Colliders section to
show and change them, or drag the X/Z arrows on the selected part or type X/Z in
its position fields to move the art offset. Y is fixed by the prefab lift. The
body reference is always shown for heads. The view gizmo snaps the camera like
Unity, `W`/`R` switch tools, and `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo edits. It
validates before writing, so a bad save never leaves the content registry
broken.

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
    "mount": "forward",
    "projectile": {
      "speed": 12,
      "ttl": 1.2,
      "visual": "bullet",
      "damage": 1
    }
  }
}
```

## Rules

- `id` must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Head and body ids may repeat. `head:gun` and `body:gun` are different parts.
- The slot comes from the folder (`heads` or `bodies`), never from the file.
- `boxes` is required and must contain at least one Unity BoxCollider. It is the
  part's hit shape; there is no fallback circle.
- `attack` is optional. Parts without an attack only deal contact damage through
  their `hitbox` boxes.
- `offset` is optional and defaults to `[0, 0]`. It shifts the art only, in raw
  prefab units, so a head can line up with the body chain without moving its
  colliders. Drag the X/Z arrows in the editor or type X/Z into the position
  fields; Y is fixed by the prefab lift.
- Attacks are data, not functions. The simulation interprets them; do not import
  three.js, the DOM or `Math.random`.
- `score` is what a killer earns for destroying this part.
- `visual` is a string key used by the renderer, not a texture path.

## Colliders

The original game has no simple circle around a head or a body. Each part
carries the trigger BoxColliders authored in its Unity art prefab. The editor is
the primary way to author them now: tick **Edit**, then drag a box over the art,
edit its centre and size, and mark the claw boxes. The shipped values are copied
straight from the prefab `m_Center` and `m_Size`, so they are exact:

1. Open the art prefab, for example `HeadClaw01.prefab` or `BodySpike02.prefab`.
   Do not copy from the gameplay `Head.prefab` or `Body.prefab`.
2. For every BoxCollider with `m_IsTrigger: 1`, copy `m_Center` and `m_Size`
   x/y/z into one `boxes` entry.
3. Copy the rotation of the GameObject the collider hangs on, in Unity Euler
   degrees, into `rotation`. The Inspector shows these values; leave it out for
   an identity rotation. Both the centre and the box axes turn around the part
   pivot.
4. A child named `Body` is only a hurtbox: leave `hitbox` off. A child named
   `Claw` also deals contact damage: add `"hitbox": true`.
5. Ignore `BulletFire`, `Skeleton`, MeshCollider and any non-trigger collider.
6. Use the raw Unity numbers. The definition scales them by the prefab's 0.25
   art scale, so the boxes always line up with the model.
7. The centre is relative to the part pivot. Local `+z` points forward, the same
   direction the model faces.

For the spike body, the main body plus a rotated claw looks like this:

```json
"boxes": [
  { "center": [0, 0, -0.05], "size": [1.5, 0.9, 1.15] },
  { "center": [4.1, 0.25, 1.38], "size": [1.5, 0.25, 0.6], "rotation": [0, 20, 0], "hitbox": true }
]
```

The simulation runs on the XZ plane, so collision uses the rotated centre and
the box yaw. X/Z tilt barely changes the footprint and is ignored there, but the
editor still draws the box with the full rotation. Y is kept so the box matches
the Unity BoxCollider; the editor adds the prefab's 0.125 lift when it draws the
box, so it sits at the same height as the art.

All boxes are hurtboxes, so a projectile or another claw can damage any of them.
Only `hitbox` boxes cause contact damage, with the part's `contact.damage`.
That is why a gun head has `"contact": { "damage": 0 }`: its Unity prefab has only
a `Body` collider, while every claw head has `Claw` boxes.

If a part has no Unity prefab yet, start from a box that covers the visible
model. The box may be smaller than the art, but it must not be empty.

## Attack shapes

A projectile, with an optional hazard left where it lands:

```json
"attack": {
  "kind": "projectile",
  "cooldown": 1,
  "mount": "forward",
  "projectile": {
    "speed": 14,
    "ttl": 1.1,
    "visual": "poison",
    "damage": 1,
    "onLand": { "delay": 0.1, "duration": 4, "radius": 1.6 }
  }
}
```

`mount` is `"forward"` or `"sides"` to fire left and right.

An immediate cone hit around the part:

```json
"attack": {
  "kind": "cone",
  "cooldown": 0.9,
  "cone": { "range": 2.2, "halfAngleDeg": 45, "duration": 0.3 }
}
```

## Models

The part file can carry a `model` key; it defaults to the part id. The asset check
expects `models/parts/head/<model>.glb` or `models/parts/body/<model>.glb`. A part
without a model file still plays; the renderer falls back to a colored primitive.

`src/render/models.ts` loads every registered model in the background. It keeps
the pivot authored in the model file, drops the arbitrary offset of the source
FBX scene, then applies the prefab's 0.25 scale and 0.125 lift. The `boxes`
values use the same scale, so the collider and the art share one pivot. Body
models are skinned, so they are copied with `SkeletonUtils.clone`; a plain
`clone` would leave them bound to the template bones and they would never draw
under the snake. Models must keep their first UV set: the parts share one
palette texture and take their colors from it.

## Balance

Gameplay constants live in `src/data/balance.ts`. A part file should only hold
numbers that are specific to that part.
