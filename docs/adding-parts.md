# Adding a head or a body

A part is pure data. Adding one means adding one file; the registry discovers it,
validates it with zod and hashes it for network compatibility.

## Steps

1. Create `src/content/heads/my-head.ts` or `src/content/bodies/my-body.ts`.
2. Export a default object that matches the schema below.
3. Give it a unique kebab-case id within its slot.
4. Run `npm run check`.

```ts
import { defineBody } from '../define'

export default defineBody({
  id: 'my-body',
  name: 'My Body',
  hp: 2,
  score: 5,
  contact: { damage: 1 },
  attack: {
    kind: 'projectile',
    cooldown: 1.4,
    mount: 'forward',
    projectile: {
      speed: 12,
      ttl: 1.2,
      visual: 'bullet',
      damage: 1,
    },
  },
})
```

## Rules

- `id` must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- Head and body ids may repeat. `head:gun` and `body:gun` are different parts.
- `slot` is set by the factory (`defineHead` or `defineBody`), never by hand.
- `attack` is optional. Parts without an attack only deal contact damage.
- Attacks are data, not functions. The simulation interprets them; do not import
  three.js, the DOM or `Math.random`.
- `score` is what a killer earns for destroying this part.
- `visual` is a string key used by the renderer, not a texture path.

## Attack shapes

```ts
// Projectile, with an optional hazard left where it lands.
attack: {
  kind: 'projectile',
  cooldown: 1,
  mount: 'forward', // or 'sides' to fire left and right
  projectile: {
    speed: 14,
    ttl: 1.1,
    visual: 'poison',
    damage: 1,
    onLand: { delay: 0.1, duration: 4, radius: 1.6 },
  },
}

// Immediate cone hit around the part.
attack: {
  kind: 'cone',
  cooldown: 0.9,
  cone: { range: 2.2, halfAngleDeg: 45, duration: 0.3 },
}
```

## Models

The part file can carry a `model` key; it defaults to the part id. The asset check
expects `models/parts/head/<model>.glb` or `models/parts/body/<model>.glb`. A part
without a model file still plays; the renderer falls back to a colored primitive.

## Balance

Gameplay constants live in `src/data/balance.ts`. A part file should only hold
numbers that are specific to that part.
