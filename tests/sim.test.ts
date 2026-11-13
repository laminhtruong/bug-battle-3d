import { describe, expect, it } from 'vitest'
import { BALANCE } from '@/data/balance'
import { DEFAULT_HEAD_ID, requirePart } from '@/content'
import { createWorld } from '@/sim/world'
import { updateAi } from '@/sim/ai'
import { classicArena } from '@/content/arenas/classic'
import {
  damageSegment,
  fireAttacks,
  killSnake,
  updateAreas,
  updateContact,
  updateProjectiles,
} from '@/sim/combat'
import { spawnBoss, spawnPowerup } from '@/sim/spawn'
import { tickWorld } from '@/sim/tick'
import { isPlayerControl } from '@/sim/types'
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
    const players = world.snakes.filter((snake) => isPlayerControl(snake.control))
    expect(players).toHaveLength(BALANCE.maxPlayers)
    expect(players.map((snake) => snake.slot)).toEqual([0, 1, 2, 3])
    expect(world.snakes.filter((snake) => snake.control === 'enemy')).toHaveLength(
      classicArena.enemyCap,
    )
    expect(world.pickups.length).toBeGreaterThanOrEqual(classicArena.appleTarget)
    expect(world.snakes.some((snake) => snake.control === 'boss')).toBe(false)
  })

  it('refills a wandering bug after it dies', () => {
    const world = createWorld({ seed: 44, arena: classicArena })
    const enemy = world.snakes.find((snake) => snake.control === 'enemy')
    if (!enemy) {
      throw new Error('expected a wandering bug')
    }
    killSnake(world, enemy)
    expect(enemy.alive).toBe(false)
    expect(
      world.snakes.filter((snake) => snake.control === 'enemy' && snake.alive),
    ).toHaveLength(classicArena.enemyCap - 1)

    for (let index = 0; index <= BALANCE.enemyRespawnSec * BALANCE.tickRate + 5; index += 1) {
      tickWorld(world, STEP)
    }

    expect(
      world.snakes.filter((snake) => snake.control === 'enemy' && snake.alive),
    ).toHaveLength(classicArena.enemyCap)
  })

  it('makes a wandering bug chase a nearby player', () => {
    const world = createWorld({ seed: 45, arena: classicArena })
    const enemy = world.snakes.find((snake) => snake.control === 'enemy')
    const player = getSnake(world, 'bot-1')
    if (!enemy) {
      throw new Error('expected a wandering bug')
    }
    // Move the other players away so the test only sees bot-1.
    for (const other of world.snakes.filter((snake) => isPlayerControl(snake.control))) {
      placeHead(other, 90, 90)
    }
    placeHead(player, 0, 10)
    placeHead(enemy, 0, 0)
    enemy.ai.retargetAt = world.time + 10

    updateAi(world, enemy)

    expect(enemy.steerZ).toBeGreaterThan(0.5)
  })

  it('starts every bug with a head and three normal bodies', () => {
    const world = createWorld({ seed: 2, arena: classicArena })
    for (const snake of world.snakes.filter((entry) => isPlayerControl(entry.control))) {
      expect(snake.segments).toHaveLength(BALANCE.food.startSegments)
      expect(snake.segments[0]?.slot).toBe('head')
      for (const segment of snake.segments.slice(1)) {
        expect(segment).toMatchObject({ slot: 'body', partId: 'normal', dead: false })
      }
    }
  })

  it('scatters destructible power-ups with random health', () => {
    const world = createWorld({ seed: 3, arena: classicArena })
    const powerups = world.snakes.filter((snake) => snake.control === 'powerup')
    expect(powerups).toHaveLength(classicArena.powerupTarget)
    for (const powerup of powerups) {
      expect(powerup.segments).toHaveLength(1)
      expect(powerup.segments[0]?.hp).toBeGreaterThanOrEqual(BALANCE.powerupHpMin)
      expect(powerup.segments[0]?.hp).toBeLessThanOrEqual(BALANCE.powerupHpMax)
    }
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

  it('builds a boss with a good head and varied bodies', () => {
    const world = createWorld({ seed: 31, arena: classicArena })
    const boss = spawnBoss(world)
    expect(boss.segments).toHaveLength(classicArena.bossBodyCount + 1)
    const head = boss.segments[0]
    const bodyIds = boss.segments.slice(1).map((segment) => segment.partId)
    expect(head).toBeDefined()
    expect(classicArena.bossHeads).toContain(head?.partId)
    expect(new Set(bodyIds).size).toBeGreaterThanOrEqual(
      Math.min(classicArena.bossBodies.length, classicArena.bossBodyCount),
    )
  })

  it('weaves to a flank instead of chasing in a straight line', () => {
    const world = createWorld({ seed: 32, arena: classicArena })
    const boss = spawnBoss(world)
    const player = getSnake(world, 'bot-1')
    boss.id = 'boss-3'
    boss.x = 0
    boss.z = 0
    boss.segments[0]!.cooldown = 2
    player.x = 0
    player.z = 40
    player.angle = 0
    player.speed = BALANCE.playerSpeed

    updateAi(world, boss)

    // A direct chase would aim at x = 0; the flank moves the aim sideways.
    expect(Math.abs(boss.ai.targetX)).toBeGreaterThan(1)
    expect(boss.steerZ).toBeGreaterThan(0)
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
      // Keep one apple so the bigger pickup radius cannot collect several at once.
      world.pickups = [apple]
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
      // Apples are spawned at the end of a tick; drop them so the fresh snake
      // cannot eat one on the respawn tick.
      world.pickups = []
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

describe('arena targets', () => {
  it('drops a head 30 percent of the time and a body otherwise', () => {
    const world = createWorld({ seed: 41, arena: classicArena })
    const originalNext = world.rng.next

    world.rng.next = () => 0.1
    const headPowerup = spawnPowerup(world)
    killSnake(world, headPowerup)
    const headDrop = world.pickups.find((pickup) => pickup.kind === 'head')
    expect(headDrop?.partId).toBeDefined()

    world.pickups = world.pickups.filter((pickup) => pickup.kind === 'apple')
    world.rng.next = () => 0.5
    const bodyPowerup = spawnPowerup(world)
    killSnake(world, bodyPowerup)
    const bodyDrop = world.pickups.find((pickup) => pickup.kind === 'body')
    expect(bodyDrop?.partId).toBeDefined()

    world.rng.next = originalNext
  })

  it('drops exactly ten boss parts, including its head', () => {
    const world = createWorld({ seed: 42, arena: classicArena })
    const boss = spawnBoss(world)
    const headId = boss.segments[0]?.partId

    killSnake(world, boss)

    const loot = world.pickups.filter(
      (pickup) => pickup.kind === 'head' || pickup.kind === 'body',
    )
    expect(loot).toHaveLength(BALANCE.bossLootCount)
    expect(loot.some((pickup) => pickup.kind === 'head' && pickup.partId === headId)).toBe(true)
    expect(world.bossSpawnAt).toBe(world.time + classicArena.bossEverySec)
  })

  it('spawns a boss after the arena delay', () => {
    const world = createWorld({ seed: 43, arena: classicArena })
    expect(world.snakes.some((snake) => snake.control === 'boss')).toBe(false)

    while (world.time < classicArena.bossEverySec) {
      tickWorld(world, STEP)
    }

    expect(world.snakes.some((snake) => snake.control === 'boss')).toBe(true)
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
    const part = requirePart('head', 'gun')
    if (part.attack?.kind !== 'projectile') {
      throw new Error('gun head is not a projectile')
    }
    const muzzle = part.attack.projectile.spawnPoints[0]!
    // The muzzle is authored in the same units as the art.
    expect(shot.x).toBeCloseTo(1 + muzzle.z, 5)
    expect(shot.z).toBeCloseTo(2 - muzzle.x, 5)
    expect(shot.vx).toBeCloseTo(part.attack.projectile.speed, 5)
    expect(shot.vz).toBeCloseTo(0, 5)
  })

  it('fires a cone from its spawn point', () => {
    const world = createWorld({ seed: 16, arena: classicArena })
    const shooter = getSnake(world, 'bot-2')
    const target = getSnake(world, 'bot-1')
    const head = shooter.segments[0]
    if (!head) {
      throw new Error('missing head')
    }
    head.partId = 'fire'
    head.angle = 0
    head.cooldown = 0
    placeHead(shooter, 0, 0)

    const part = requirePart('head', 'fire')
    if (part.attack?.kind !== 'cone') {
      throw new Error('fire head is not a cone')
    }
    const cone = part.attack.cone
    const original = cone.spawnPoints
    // Muzzle two arena units ahead, so the target is out of reach from the part
    // but inside the cone.
    cone.spawnPoints = [{ x: 0, y: 2, z: 2, angle: 0 }]
    placeHead(target, 0, 2 + cone.range / 2)
    const hp = target.segments[0]?.hp ?? 0
    try {
      fireAttacks(world, 0)
    } finally {
      cone.spawnPoints = original
    }

    expect(target.segments[0]?.hp).toBe(hp - 1)
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
      y: 0.5,
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
