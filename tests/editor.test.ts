import { describe, expect, it } from 'vitest'
import { defineHead } from '@/content/define'
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
})
