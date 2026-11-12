import { defineHead } from '../define'

export default defineHead({
  id: 'fire',
  name: 'Flamer',
  hp: 2,
  score: 60,
  contact: { damage: 1 },
  attack: {
    kind: 'cone',
    cooldown: 1,
    cone: { range: 4, halfAngleDeg: 25, duration: 0.3 },
  },
})
