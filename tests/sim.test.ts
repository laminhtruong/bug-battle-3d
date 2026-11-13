import { describe, expect, it } from 'vitest'
import { BALANCE } from '@/data/balance'
import { DEFAULT_HEAD_ID } from '@/content'
import { createWorld } from '@/sim/world'
import { updateAi } from '@/sim/ai'
import { classicArena } from '@/content/arenas/classic'
import {
  damageSegment,
  fireAttacks,
  updateAreas,
  updateContact,
  updateProjectiles,
} from '@/sim/combat'
import { tickWorld } from '@/sim/tick'
import type { Projectile, Snake, World } from '@/sim/types'

const STEP = 1 / BALANCE.tickRate

function getSnake(world: World, id: string): Snake {
  const snake = world.snakes.find((candidate) => candidate.id === id)
  if (!snake) {
    throw new Error(`missing snake ${id}`)
  }
  return snake
}

function placeHead(snake: Snake, x: number, z: number): void {
  snake.x = x
  snake.z = z
  const head = snake.segments[0]
  if (head) {
    head.x = x
    head.z = z
  }
}

describe('world', () => {
  it('fills four player slots with bots', () => {
    const world = createWorld({ seed: 1, arena: classicArena })
    const players = world.snakes.filter((snake) => snake.control !== 'enemy')
    expect(players).toHaveLength(BALANCE.maxPlayers)
    expect(players.map((snake) => snake.slot)).toEqual([0, 1, 2, 3])
    expect(world.snakes.filter((snake) => snake.control === 'enemy')).toHaveLength(
      classicArena.enemyCap,
    )
    expect(world.pickups.length).toBeGreaterThanOrEqual(classicArena.appleTarget)
  })

  it('is deterministic for a seed', () => {
    const first = createWorld({ seed: 42, arena: classicArena })
    const second = createWorld({ seed: 42, arena: classicArena })
    for (let index = 0; index < 300; index += 1) {
      tickWorld(first, STEP)
      tickWorld(second, STEP)
    }
    expect(JSON.stringify(first.snakes)).toBe(JSON.stringify(second.snakes))
    expect(JSON.stringify(first.pickups)).toBe(JSON.stringify(second.pickups))
    expect(JSON.stringify(first.projectiles)).toBe(JSON.stringify(second.projectiles))
  })

  it('keeps snakes inside the arena', () => {
    const world = createWorld({ seed: 3, arena: classicArena })
    for (let index = 0; index < 600; index += 1) {
      tickWorld(world, STEP)
    }
    for (const snake of world.snakes) {
      expect(Math.abs(snake.x)).toBeLessThanOrEqual(classicArena.width / 2)
      expect(Math.abs(snake.z)).toBeLessThanOrEqual(classicArena.depth / 2)
    }
  })

  it('lets normal bugs wander instead of chasing the player', () => {
    const world = createWorld({ seed: 31, arena: classicArena })
    const enemy = world.snakes.find((snake) => snake.control === 'enemy')
    const player = getSnake(world, 'bot-1')
    expect(enemy).toBeDefined()
    if (!enemy) {
      return
    }
    // Put the player right next to the bug and its own target on the far side.
    enemy.x = 0
    enemy.z = 0
    player.x = 0
    player.z = 2
    enemy.ai.targetX = 0
    enemy.ai.targetZ = -10
    enemy.ai.retargetAt = world.time + 10

    updateAi(world, enemy)

    expect(enemy.steerX).toBeCloseTo(0, 5)
    expect(enemy.steerZ).toBeCloseTo(-1, 5)
  })

  it('grows after eating the required apples', () => {
    const world = createWorld({ seed: 5, arena: classicArena })
    const player = getSnake(world, 'bot-1')
    const startSegments = player.segments.length

    for (let eaten = 0; eaten < BALANCE.food.applesToGrow; eaten += 1) {
      const apple = world.pickups.find((pickup) => pickup.kind === 'apple')
      if (!apple) {
        throw new Error('expected an apple')
      }
      placeHead(player, apple.x, apple.z)
      tickWorld(world, STEP)
    }

    expect(player.segments.length).toBe(startSegments + 1)
    expect(player.food).toBe(0)
    expect(player.score).toBe(BALANCE.food.applesToGrow * BALANCE.food.scorePerApple)
  })

  it('respawns a player after the death delay', () => {
    const world = createWorld({ seed: 8, arena: classicArena })
    const player = getSnake(world, 'bot-1')
    damageSegment(world, player, 0, 99, undefined, world.time)
    expect(player.alive).toBe(false)
    expect(player.segments).toHaveLength(0)

    for (let index = 0; index <= BALANCE.respawnDelaySec * BALANCE.tickRate; index += 1) {
      tickWorld(world, STEP)
    }

    expect(player.alive).toBe(true)
    expect(player.segments.length).toBe(BALANCE.food.startSegments)
  })

  it('only moves while the stick is pushed', () => {
    const world = createWorld({
      seed: 21,
      arena: classicArena,
      players: [{ id: 'you', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const player = getSnake(world, 'you')
    const startX = player.x
    const startZ = player.z

    tickWorld(world, STEP)
    expect(player.x).toBeCloseTo(startX, 5)
    expect(player.z).toBeCloseTo(startZ, 5)

    player.steerX = 1
    player.steerZ = 0
    tickWorld(world, STEP)
    expect(player.x).not.toBeCloseTo(startX, 5)
  })

  it('places the first body segment at the head spacing', () => {
    const world = createWorld({
      seed: 22,
      arena: classicArena,
      players: [{ id: 'you', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const player = getSnake(world, 'you')
    const head = player.segments[0]
    const body = player.segments[1]
    expect(head).toBeDefined()
    expect(body).toBeDefined()
    if (!head || !body) {
      return
    }
    expect(Math.hypot(head.x - body.x, head.z - body.z)).toBeCloseTo(BALANCE.headSpacing, 5)
  })
})

describe('survival', () => {
  it('keeps fighting after the head is lost', () => {
    const world = createWorld({ seed: 23, arena: classicArena })
    const player = getSnake(world, 'bot-1')
    // Give the snake a body that can fight back.
    player.segments[1]!.partId = 'spike01'

    damageSegment(world, player, 0, 99, undefined, world.time)

    expect(player.alive).toBe(true)
    expect(player.segments[0]?.dead).toBe(true)
    expect(player.segments[1]?.dead).toBe(false)
  })

  it('dies once nothing can attack anymore', () => {
    const world = createWorld({ seed: 24, arena: classicArena })
    const player = getSnake(world, 'bot-1')

    damageSegment(world, player, 0, 99, undefined, world.time)

    expect(player.alive).toBe(false)
    expect(player.segments).toHaveLength(0)
  })

  it('brings the head back when a head is collected', () => {
    const world = createWorld({ seed: 25, arena: classicArena })
    const player = getSnake(world, 'bot-1')
    player.segments[1]!.partId = 'spike01'
    damageSegment(world, player, 0, 99, undefined, world.time)
    expect(player.alive).toBe(true)

    world.pickups.push({
      id: 'head-drop',
      kind: 'head',
      partId: 'gun',
      x: player.x,
      z: player.z,
      expireAt: world.time + 10,
    })
    tickWorld(world, STEP)

    expect(player.segments[0]?.dead).toBe(false)
    expect(player.segments[0]?.partId).toBe('gun')
  })
})

describe('combat', () => {
  it('applies contact damage both ways', () => {
    const world = createWorld({ seed: 11, arena: classicArena })
    const first = getSnake(world, 'bot-1')
    const second = getSnake(world, 'bot-2')
    placeHead(first, 0, 0)
    placeHead(second, 0, 0)
    // The collider boxes are directional, so face both heads the same way.
    first.segments[0]!.angle = 0
    second.segments[0]!.angle = 0
    const firstHp = first.segments[0]?.hp ?? 0
    const secondHp = second.segments[0]?.hp ?? 0

    updateContact(world)

    expect(first.segments[0]?.hp).toBeLessThan(firstHp)
    expect(second.segments[0]?.hp).toBeLessThan(secondHp)
  })

  it('reaches with the long claw collider', () => {
    const world = createWorld({ seed: 16, arena: classicArena })
    const attacker = getSnake(world, 'bot-1')
    const target = getSnake(world, 'bot-2')
    attacker.segments[0]!.partId = 'claw04'
    target.segments[0]!.partId = 'gun'
    attacker.segments[0]!.angle = 0
    target.segments[0]!.angle = 0
    placeHead(attacker, 0, 0)
    placeHead(target, 0, 1)
    const attackerHp = attacker.segments[0]?.hp ?? 0
    const targetHp = target.segments[0]?.hp ?? 0

    updateContact(world)

    expect(target.segments[0]?.hp).toBe(targetHp - 1)
    expect(attacker.segments[0]?.hp).toBe(attackerHp)
  })

  it('does not hurt with a part that has no hitbox', () => {
    const world = createWorld({ seed: 15, arena: classicArena })
    const first = getSnake(world, 'bot-1')
    const second = getSnake(world, 'bot-2')
    first.segments[0]!.partId = 'gun'
    second.segments[0]!.partId = 'gun'
    placeHead(first, 0, 0)
    placeHead(second, 0, 0)
    const firstHp = first.segments[0]?.hp ?? 0
    const secondHp = second.segments[0]?.hp ?? 0

    updateContact(world)

    expect(first.segments[0]?.hp).toBe(firstHp)
    expect(second.segments[0]?.hp).toBe(secondHp)
  })

  it('fires from the configured spawn point', () => {
    const world = createWorld({ seed: 15, arena: classicArena })
    const shooter = getSnake(world, 'bot-2')
    const head = shooter.segments[0]
    if (!head) {
      throw new Error('missing head')
    }
    head.partId = 'gun'
    head.angle = Math.PI / 2
    head.cooldown = 0
    placeHead(shooter, 1, 2)

    fireAttacks(world, 0)

    const shots = world.projectiles.filter((shot) => shot.ownerId === shooter.id)
    expect(shots).toHaveLength(1)
    const shot = shots[0]!
    // The muzzle sits 1.96 prefab units forward, so 0.49 arena units ahead.
    expect(shot.x).toBeCloseTo(1.49, 5)
    expect(shot.z).toBeCloseTo(2, 5)
    expect(shot.vx).toBeCloseTo(5, 5)
    expect(shot.vz).toBeCloseTo(0, 5)
  })

  it('hits a segment with a projectile', () => {
    const world = createWorld({ seed: 12, arena: classicArena })
    const target = getSnake(world, 'bot-1')
    const shooter = getSnake(world, 'bot-2')
    placeHead(target, 0, 0)
    const hp = target.segments[0]?.hp ?? 0
    const projectile: Projectile = {
      id: 'test-shot',
      ownerId: shooter.id,
      partId: 'gun',
      visual: 'bullet',
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      damage: 1,
      age: 0,
      ttl: 1,
      landed: false,
      delayLeft: 0,
    }
    world.projectiles.push(projectile)

    updateProjectiles(world, STEP)

    expect(target.segments[0]?.hp).toBe(hp - 1)
    expect(world.projectiles).toHaveLength(0)
  })

  it('damages segments inside an area', () => {
    const world = createWorld({ seed: 13, arena: classicArena })
    const target = getSnake(world, 'bot-1')
    placeHead(target, 0, 0)
    const hp = target.segments[0]?.hp ?? 0
    world.areas.push({
      id: 'test-area',
      ownerId: 'bot-2',
      partId: 'poison',
      x: 0,
      z: 0,
      radius: 1,
      damage: 1,
      duration: 1,
      age: 0,
    })

    updateAreas(world, STEP)

    expect(target.segments[0]?.hp).toBe(hp - 1)
  })

  it('respects the hurt cooldown', () => {
    const world = createWorld({ seed: 14, arena: classicArena })
    const target = getSnake(world, 'bot-1')
    const attacker = getSnake(world, 'bot-2')
    const hp = target.segments[0]?.hp ?? 0

    damageSegment(world, target, 0, 1, attacker, 0)
    damageSegment(world, target, 0, 1, attacker, 0)

    expect(target.segments[0]?.hp).toBe(hp - 1)
  })
})
