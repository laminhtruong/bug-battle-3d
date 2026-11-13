import { defineHead } from '../define'

export default defineHead({
  id: 'claw04',
  name: 'Claw IV',
  hp: 2,
  score: 50,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0, 0.05], size: [2, 1.5, 1.5] },
    { center: [0.05, -0.15, 1.6], size: [1, 0.3, 1.25], hitbox: true },
    { center: [-0.05, -0.15, 1.6], size: [1, 0.3, 1.25], hitbox: true },
    { center: [0, -0.25, 2.9], size: [0.5, 0.3, 3.5], hitbox: true },
    { center: [2.5, -0.1, 4], size: [2.1, 0.6, 0.4], hitbox: true },
    { center: [-2.5, -0.1, 4], size: [2.1, 0.6, 0.4], hitbox: true },
    { center: [0, -0.1, 3.5], size: [3, 0.6, 0.6], hitbox: true },
    { center: [4.95, -0.01, 2.65], size: [0.2, 0.2, 0.75], hitbox: true },
    { center: [-4.95, -0.01, 2.65], size: [0.2, 0.2, 0.75], hitbox: true },
  ],
})
