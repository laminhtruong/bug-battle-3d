import { describe, expect, it } from 'vitest'
import {
  BODIES,
  CONTENT_HASH,
  DEFAULT_BODY_ID,
  DEFAULT_HEAD_ID,
  HEADS,
  PARTS,
  getPart,
  requirePart,
} from '@/content'
import { idPattern } from '@/content/define'
import { classicArena } from '@/content/arenas/classic'

describe('content registry', () => {
  it('loads the shipped heads and bodies', () => {
    expect(HEADS.length).toBe(8)
    expect(BODIES.length).toBe(7)
    expect(PARTS.length).toBe(15)
    expect(getPart('head', DEFAULT_HEAD_ID)?.slot).toBe('head')
    expect(getPart('body', DEFAULT_BODY_ID)?.slot).toBe('body')
  })

  it('uses kebab-case ids and unique keys', () => {
    const ids = PARTS.map((part) => `${part.slot}:${part.id}`)
    expect(new Set(ids).size).toBe(ids.length)
    for (const part of PARTS) {
      expect(part.id).toMatch(idPattern)
    }
  })

  it('keeps every part playable', () => {
    for (const part of PARTS) {
      expect(part.hp).toBeGreaterThan(0)
      expect(part.score).toBeGreaterThanOrEqual(0)
      expect(part.contact.damage).toBeGreaterThanOrEqual(0)
      expect(part.collider.boxes.length).toBeGreaterThan(0)
      expect(part.collider.reach).toBeGreaterThan(0)
      // Contact damage can only come from a box copied from a "Claw" collider.
      if (!part.collider.boxes.some((box) => box.hitbox)) {
        expect(part.contact.damage).toBe(0)
      }
      if (part.attack?.kind === 'projectile') {
        expect(part.attack.projectile.speed).toBeGreaterThan(0)
        expect(part.attack.projectile.ttl).toBeGreaterThan(0)
        expect(part.attack.projectile.spawnPoints.length).toBeGreaterThan(0)
      }
      if (part.attack?.kind === 'cone') {
        expect(part.attack.cone.spawnPoints.length).toBeGreaterThan(0)
      }
      expect(requirePart(part.slot, part.id).id).toBe(part.id)
    }
  })

  it('exposes a stable content hash', () => {
    expect(CONTENT_HASH).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('classic arena', () => {
  it('keeps spawns inside the bounds', () => {
    expect(classicArena.spawns.length).toBe(4)
    for (const spawn of classicArena.spawns) {
      expect(Math.abs(spawn.x)).toBeLessThan(classicArena.width / 2)
      expect(Math.abs(spawn.z)).toBeLessThan(classicArena.depth / 2)
    }
  })

  it('only references known part ids', () => {
    expect(classicArena.powerupTarget).toBeGreaterThan(0)
    expect(classicArena.enemyCap).toBeGreaterThan(0)
    expect(classicArena.bossEverySec).toBeGreaterThan(0)
    for (const id of classicArena.enemyHeads) {
      expect(getPart('head', id)).toBeDefined()
    }
    for (const id of classicArena.enemyBodies) {
      expect(getPart('body', id)).toBeDefined()
    }
    for (const id of classicArena.bossHeads) {
      expect(getPart('head', id)).toBeDefined()
    }
    for (const id of classicArena.bossBodies) {
      expect(getPart('body', id)).toBeDefined()
    }
  })
})
