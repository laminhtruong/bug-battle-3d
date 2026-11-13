import type { ArenaDef } from '../arena'

export const classicArena: ArenaDef = {
  id: 'classic',
  name: 'Classic Yard',
  width: 192,
  depth: 192,
  spawns: [
    { x: -64, z: -64 },
    { x: 64, z: -64 },
    { x: -64, z: 64 },
    { x: 64, z: 64 },
  ],
  floorTexture: 'floor-base',
  durationSec: 90,
  enemyCap: 12,
  appleTarget: 20,
  enemyHeads: ['claw01', 'claw02', 'claw03', 'gun'],
  enemyBodies: ['normal', 'spike01'],
}
