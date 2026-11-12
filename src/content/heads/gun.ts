import { defineHead } from '../define'

export default defineHead({
  id: 'gun',
  name: 'Gunner',
  hp: 2,
  score: 20,
  contact: { damage: 1 },
  attack: {
    kind: 'projectile',
    cooldown: 0.25,
    mount: 'forward',
    projectile: { speed: 5, ttl: 0.5, visual: 'bullet' },
  },
})
