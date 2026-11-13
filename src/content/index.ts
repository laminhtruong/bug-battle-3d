import { fnv1a } from '@/core/rng'
import type { PartDef, PartInput, Slot } from './define'
import { definePart } from './define'

const headModules = import.meta.glob<{ default: PartInput }>('./heads/*.json', { eager: true })
const bodyModules = import.meta.glob<{ default: PartInput }>('./bodies/*.json', { eager: true })

function collect(
  modules: Record<string, { default: PartInput }>,
  slot: 'head' | 'body',
): PartDef[] {
  const parts = Object.values(modules)
    .map((module) => definePart(slot, module.default))
    .sort((a, b) => a.id.localeCompare(b.id))

  for (const part of parts) {
    if (part.slot !== slot) {
      throw new Error(`part "${part.id}" is registered as ${part.slot}, expected ${slot}`)
    }
  }
  return parts
}

export const HEADS: readonly PartDef[] = collect(headModules, 'head')
export const BODIES: readonly PartDef[] = collect(bodyModules, 'body')
export const PARTS: readonly PartDef[] = [...HEADS, ...BODIES]

const partsByKey = new Map<string, PartDef>(PARTS.map((part) => [`${part.slot}:${part.id}`, part]))

if (partsByKey.size !== PARTS.length) {
  throw new Error('duplicate part id in content registry')
}

export function getPart(slot: Slot, id: string): PartDef | undefined {
  return partsByKey.get(`${slot}:${id}`)
}

export function requirePart(slot: Slot, id: string): PartDef {
  const part = partsByKey.get(`${slot}:${id}`)
  if (!part) {
    throw new Error(`unknown ${slot} part id: ${id}`)
  }
  return part
}

export const DEFAULT_HEAD_ID = 'claw01'
export const DEFAULT_BODY_ID = 'normal'

/**
 * Covers the stats and colliders, not only the ids, so a host and a guest with
 * different part data cannot start a match. `reach` is derived, so it is left
 * out to avoid platform-dependent float formatting.
 */
const signature = PARTS.map(({ collider, ...part }) => ({ ...part, boxes: collider.boxes }))
export const CONTENT_HASH = fnv1a(JSON.stringify(signature))

export { classicArena } from './arenas/classic'
