import { defineBody } from '../define'

export default defineBody({
  id: 'poison',
  name: 'Poison Body',
  hp: 1,
  score: 50,
  contact: { damage: 0 },
  attack: {
    kind: 'projectile',
    cooldown: 3,
    mount: 'sides',
    projectile: {
      speed: 3,
      ttl: 0.5,
      visual: 'poison',
      onLand: { duration: 0.5, radius: 1.2 },
    },
  },
})
