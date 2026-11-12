import { defineHead } from '../define'

export default defineHead({
  id: 'lightning',
  name: 'Stormer',
  hp: 2,
  score: 60,
  contact: { damage: 1 },
  attack: {
    kind: 'projectile',
    cooldown: 1.5,
    mount: 'forward',
    projectile: {
      speed: 5,
      ttl: 0.5,
      visual: 'lightning',
      onLand: { delay: 0.5, duration: 0.5, radius: 1.8 },
    },
  },
})
