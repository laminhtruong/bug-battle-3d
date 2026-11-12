import { fnv1a } from '@/core/rng'
import type { PartDef, Slot } from './define'
import { parsePart } from './define'

const headModules = import.meta.glob<{ default: unknown }>('./heads/*.ts', { eager: true })
const bodyModules = import.meta.glob<{ default: unknown }>('./bodies/*.ts', { eager: true })

function collect(modules: Record<string, { default: unknown }>, slot: 'head' | 'body'): PartDef[] {
  const parts = Object.values(modules)
    .map((module) => parsePart(module.default))
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

/** Changes whenever the set of part ids changes. Hosts and guests must match. */
export const CONTENT_HASH = fnv1a(PARTS.map((part) => `${part.slot}:${part.id}`).join(','))

export { classicArena } from './arenas/classic'
