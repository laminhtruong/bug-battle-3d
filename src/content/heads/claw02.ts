import { defineHead } from '../define'

export default defineHead({
  id: 'claw02',
  name: 'Claw II',
  hp: 2,
  score: 30,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0, 0.05], size: [2, 1.5, 1.4] },
    { center: [0.1, -0.3, 2], size: [1, 0.3, 2], rotation: [0, 40, 0], hitbox: true },
    { center: [-0.1, -0.3, 2], size: [1, 0.3, 2], rotation: [0, -40, 0], hitbox: true },
  ],
})
