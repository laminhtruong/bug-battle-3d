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
  powerupTarget: 16,
  appleTarget: 20,
  enemyCap: 8,
  enemyHeads: ['claw01', 'claw02', 'claw03', 'gun'],
  enemyBodies: ['normal', 'spike01', 'spike02'],
  bossEverySec: 30,
  bossHeads: ['claw03', 'claw04', 'fire', 'gun', 'lightning', 'poison'],
  bossBodies: ['normal', 'spike01', 'spike02', 'fire', 'gun', 'lightning', 'poison'],
  bossBodyCount: 10,
}
