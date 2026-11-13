import { defineHead } from '../define'

export default defineHead({
  id: 'claw03',
  name: 'Claw III',
  hp: 2,
  score: 40,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0.05], size: [2, 1.4] },
    { center: [0, 2.1], size: [0.5, 2.3], hitbox: true },
    { center: [-3.72, 2], size: [0.2, 0.4], hitbox: true },
    { center: [-1.65, 3.25], size: [1.5, 0.3], hitbox: true },
    { center: [3.72, 2], size: [0.2, 0.4], hitbox: true },
    { center: [1.65, 3.25], size: [1.5, 0.3], hitbox: true },
  ],
})
