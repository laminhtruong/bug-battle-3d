import { defineHead } from '../define'

export default defineHead({
  id: 'claw01',
  name: 'Claw I',
  hp: 2,
  score: 10,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0.4, 0.05], size: [2, 2.34, 1.3] },
    { center: [0.65, 0.4, 1.3], size: [0.7, 2.34, 0.8], hitbox: true },
    { center: [-0.65, 0.4, 1.3], size: [0.7, 2.34, 0.8], hitbox: true },
  ],
})
