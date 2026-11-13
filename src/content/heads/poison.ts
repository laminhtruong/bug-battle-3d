import { defineHead } from '../define'

export default defineHead({
  id: 'poison',
  name: 'Poisoner',
  hp: 2,
  score: 60,
  contact: { damage: 0 },
  boxes: [{ center: [0, 0, 0], size: [2, 1.5, 1.4] }],
  attack: {
    kind: 'projectile',
    cooldown: 2,
    mount: 'forward',
    projectile: {
      speed: 5,
      ttl: 0.5,
      visual: 'poison',
      onLand: { duration: 0.5, radius: 1.5 },
    },
  },
})
