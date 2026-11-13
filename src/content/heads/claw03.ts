import { defineHead } from '../define'

export default defineHead({
  id: 'claw03',
  name: 'Claw III',
  hp: 2,
  score: 40,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0, 0.05], size: [2, 1.5, 1.4] },
    { center: [0, -0.25, 2.1], size: [0.5, 0.3, 2.3], hitbox: true },
    { center: [-3.72, 0.25, 2], size: [0.2, 0.2, 0.4], rotation: [0, 45, 0], hitbox: true },
    { center: [-1.65, -0.2, 3.25], size: [1.5, 0.3, 0.3], rotation: [0, 15, -7], hitbox: true },
    { center: [3.72, 0.25, 2], size: [0.2, 0.2, 0.4], rotation: [0, -45, 0], hitbox: true },
    { center: [1.65, -0.2, 3.25], size: [1.5, 0.3, 0.3], rotation: [0, -15, 7], hitbox: true },
  ],
})
