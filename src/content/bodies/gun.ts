import { defineBody } from '../define'

export default defineBody({
  id: 'gun',
  name: 'Gun Body',
  hp: 1,
  score: 30,
  contact: { damage: 0 },
  boxes: [{ center: [0, -0.05], size: [1.5, 1.15] }],
  attack: {
    kind: 'projectile',
    cooldown: 1,
    mount: 'sides',
    projectile: { speed: 3, ttl: 0.5, visual: 'bullet' },
  },
})
