import { defineBody } from '../define'

export default defineBody({
  id: 'spike01',
  name: 'Spike I',
  hp: 1,
  score: 20,
  contact: { damage: 1 },
  boxes: [
    { center: [0, -0.17, -0.05], size: [1.5, 1.3, 1.15] },
    { center: [-1.4, -0.17, -0.05], size: [1.3, 1.3, 0.25], hitbox: true },
    { center: [1.4, -0.17, -0.05], size: [1.3, 1.3, 0.25], hitbox: true },
  ],
})
