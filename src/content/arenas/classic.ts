import type { ArenaDef } from '../arena'

export const classicArena: ArenaDef = {
  id: 'classic',
  name: 'Classic Yard',
  width: 48,
  depth: 48,
  spawns: [
    { x: -16, z: -16 },
    { x: 16, z: -16 },
    { x: -16, z: 16 },
    { x: 16, z: 16 },
  ],
  floorTexture: 'floor-base',
  durationSec: 90,
  enemyCap: 12,
  appleTarget: 20,
  enemyHeads: ['claw01', 'claw02', 'claw03', 'gun'],
  enemyBodies: ['normal', 'spike01'],
}
