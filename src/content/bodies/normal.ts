import { defineBody } from '../define'

export default defineBody({
  id: 'normal',
  name: 'Body',
  hp: 2,
  score: 10,
  contact: { damage: 0 },
  boxes: [{ center: [0, 0, -0.05], size: [1.5, 0.9, 1.15] }],
})
