import { defineHead } from '../define'

export default defineHead({
  id: 'fire',
  name: 'Flamer',
  hp: 2,
  score: 60,
  contact: { damage: 0 },
  boxes: [{ center: [0, 0], size: [2, 1.4] }],
  attack: {
    kind: 'cone',
    cooldown: 1,
    cone: { range: 4, halfAngleDeg: 25, duration: 0.3 },
  },
})
