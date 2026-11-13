import { describe, expect, it } from 'vitest'
import { DEFAULT_SPAWN_Y, defineHead } from '@/content/define'
import { ATTACK_PRESETS, attackPreset } from '@/editor/attacks'
import { draftToJson } from '../scripts/editor-plugin'
import type { PartDraft } from '../scripts/editor-plugin'

const claw: PartDraft = {
  id: 'claw01',
  name: 'Claw I',
  hp: 2,
  score: 10,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0, 0.05], size: [2, 1.5, 1.3] },
    { center: [0.65, 0, 1.3], size: [0.7, 0.3, 0.8], hitbox: true },
    { center: [0.1, -0.3, 2], size: [1, 0.3, 2], rotation: [0, 40, 0], hitbox: true },
  ],
}

describe('part editor files', () => {
  it('writes clean JSON without schema defaults', async () => {
    const source = await draftToJson(claw, 'claw01.json')
    expect(JSON.parse(source)).toEqual(claw)
    expect(source).not.toContain('"hitbox": false')
    expect(source).not.toContain('"offset"')
    expect(source).not.toContain('"model"')
  })

  it('round-trips a saved draft through the game parser', async () => {
    const source = await draftToJson(
      { ...claw, model: 'claw-model', offset: [1.5, -0.5] },
      'claw01.json',
    )
    const part = defineHead(JSON.parse(source))
    expect(part.model).toBe('claw-model')
    expect(part.offset).toEqual([1.5, -0.5])
    expect(part.collider.boxes[2]?.rotation).toEqual([0, 40, 0])
  })

  it('writes attack spawn points without schema defaults', async () => {
    const source = await draftToJson(
      {
        ...claw,
        attack: {
          kind: 'projectile',
          cooldown: 1,
          projectile: {
            speed: 5,
            ttl: 0.5,
            visual: 'bullet',
            damage: 1,
            spawnPoints: [
              { x: 0, y: DEFAULT_SPAWN_Y, z: 1.96, angle: 0 },
              { x: 1.96, y: DEFAULT_SPAWN_Y, z: 0, angle: 90 },
            ],
            onLand: { delay: 0, duration: 0.5, radius: 1.5 },
          },
        },
      },
      'claw01.json',
    )
    expect(JSON.parse(source).attack).toEqual({
      kind: 'projectile',
      cooldown: 1,
      projectile: {
        speed: 5,
        ttl: 0.5,
        visual: 'bullet',
        spawnPoints: [
          { x: 0, z: 1.96 },
          { x: 1.96, z: 0, angle: 90 },
        ],
        onLand: { duration: 0.5, radius: 1.5 },
      },
    })
    const part = defineHead(JSON.parse(source))
    expect(part.attack?.kind).toBe('projectile')
    if (part.attack?.kind === 'projectile') {
      expect(part.attack.projectile.spawnPoints[1]?.angle).toBe(90)
    }
  })

  it('writes a cone spawn point when it moves', async () => {
    const cone = (
      spawnPoints: { x: number; y: number; z: number; angle: number }[],
    ): PartDraft => ({
      ...claw,
      attack: {
        kind: 'cone',
        cooldown: 1,
        cone: { range: 4, halfAngleDeg: 25, duration: 0.3, spawnPoints },
      },
    })

    const atOrigin = JSON.parse(
      await draftToJson(cone([{ x: 0, y: DEFAULT_SPAWN_Y, z: 0, angle: 0 }]), 'claw01.json'),
    )
    expect(atOrigin.attack.cone.spawnPoints).toBeUndefined()

    const source = await draftToJson(cone([{ x: 0, y: 4, z: 2, angle: 15 }]), 'claw01.json')
    expect(JSON.parse(source).attack.cone.spawnPoints).toEqual([{ x: 0, y: 4, z: 2, angle: 15 }])
    const part = defineHead(JSON.parse(source))
    expect(part.attack?.kind).toBe('cone')
    if (part.attack?.kind === 'cone') {
      expect(part.attack.cone.spawnPoints).toEqual([{ x: 0, y: 4, z: 2, angle: 15 }])
    }
  })

  it('turns every editor preset into a valid attack', () => {
    for (const preset of ATTACK_PRESETS) {
      const attack = preset.create()
      expect(attackPreset(attack)).toBe(preset.id)
      const part = defineHead({ ...claw, attack })
      expect(part.attack?.kind).toBe(attack.kind)
    }
  })
})
