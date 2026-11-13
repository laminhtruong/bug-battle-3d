import { describe, expect, it } from 'vitest'
import { PART_SCALE, defineHead } from '@/content/define'
import { draftToSource, partToDraft } from '../scripts/editor-plugin'

const claw = defineHead({
  id: 'claw01',
  name: 'Claw I',
  hp: 2,
  score: 10,
  contact: { damage: 1 },
  boxes: [
    { center: [0, 0, 0.05], size: [2, 1.5, 1.3] },
    { center: [0.65, 0, 1.3], size: [0.7, 0.3, 0.8], hitbox: true },
  ],
})

describe('part editor drafts', () => {
  it('turns scaled runtime boxes back into prefab units', () => {
    const draft = partToDraft(claw, PART_SCALE)
    expect(draft.id).toBe('claw01')
    expect(draft.model).toBe('claw01')
    expect(draft.boxes).toEqual([
      { center: [0, 0, 0.05], size: [2, 1.5, 1.3] },
      { center: [0.65, 0, 1.3], size: [0.7, 0.3, 0.8], hitbox: true },
    ])
    expect(draft.offset).toBeUndefined()
  })

  it('keeps a non-zero art offset', () => {
    const shifted = defineHead({
      id: 'shifted',
      name: 'Shifted',
      hp: 2,
      score: 10,
      contact: { damage: 0 },
      offset: [1.5, -0.5],
      boxes: [{ center: [0, 0, 0], size: [2, 1.5, 1.4] }],
    })
    expect(partToDraft(shifted, PART_SCALE).offset).toEqual([1.5, -0.5])
  })

  it('writes a clean part file without schema defaults', async () => {
    const source = await draftToSource('head', partToDraft(claw, PART_SCALE), 'claw01.ts')
    expect(source).toContain("import { defineHead } from '../define'")
    expect(source).toContain('defineHead(')
    expect(source).toContain("id: 'claw01'")
    expect(source).toContain('center: [0, 0, 0.05]')
    expect(source).toContain('size: [2, 1.5, 1.3]')
    expect(source).toContain('hitbox: true')
    expect(source).not.toContain('hitbox: false')
    expect(source).not.toContain('offset:')
  })
})
