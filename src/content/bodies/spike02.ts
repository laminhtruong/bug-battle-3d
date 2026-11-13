import { defineBody } from '../define'

export default defineBody({
  id: 'spike02',
  name: 'Spike II',
  hp: 1,
  score: 40,
  contact: { damage: 1 },
  boxes: [
    { center: [0, -0.19, -0.05], size: [1.5, 1.26, 1.15] },
    { center: [1.45, -0.19, -0.13], size: [1.45, 1.26, 0.3], hitbox: true },
    { center: [-1.45, -0.19, -0.13], size: [1.45, 1.26, 0.3], hitbox: true },
    { center: [2.9, -0.19, 0.25], size: [1.5, 1.26, 0.2], hitbox: true },
    { center: [-2.9, -0.19, 0.25], size: [1.5, 1.26, 0.2], hitbox: true },
    { center: [4.1, -0.19, 1.38], size: [1.5, 1.26, 0.6], hitbox: true },
    { center: [-4.1, -0.19, 1.38], size: [1.5, 1.26, 0.6], hitbox: true },
  ],
})
