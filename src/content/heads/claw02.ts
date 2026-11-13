import { defineHead } from '../define'

export default defineHead({
  id: 'claw02',
  name: 'Claw II',
  hp: 2,
  score: 30,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0.4, 0.05], size: [2, 2.34, 1.4] },
    { center: [0.1, 0.4, 2], size: [1, 2.34, 2], hitbox: true },
    { center: [-0.1, 0.4, 2], size: [1, 2.34, 2], hitbox: true },
  ],
})
