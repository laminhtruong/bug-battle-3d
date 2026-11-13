import { describe, expect, it } from 'vitest'
import { BALANCE } from '@/data/balance'
import { DEFAULT_BODY_ID, DEFAULT_HEAD_ID, requirePart } from '@/content'
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
import { spawnBoss, spawnPowerup, createPickup } from '@/sim/spawn'
import { updateMovement } from '@/sim/snake'
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

  it('spawns each player at a random, spaced out arena point', () => {
    const spot = (seed: number) =>
      createWorld({ seed, arena: classicArena })
        .snakes.filter((snake) => isPlayerControl(snake.control))
        .map((snake) => `${snake.x.toFixed(2)},${snake.z.toFixed(2)}`)

    expect(spot(71)).not.toEqual(spot(72))

    const world = createWorld({ seed: 71, arena: classicArena })
    const players = world.snakes.filter((snake) => isPlayerControl(snake.control))
    for (const snake of players) {
      expect(Math.abs(snake.x)).toBeLessThan(classicArena.width / 2)
      expect(Math.abs(snake.z)).toBeLessThan(classicArena.depth / 2)
    }
    for (const first of players) {
      for (const second of players) {
        if (first.slot >= second.slot) {
          continue
        }
        expect(Math.hypot(first.x - second.x, first.z - second.z)).toBeGreaterThanOrEqual(
          BALANCE.playerSpawnMinDistance,
        )
      }
    }
  })

  it('refills a wandering bug after it dies', () => {
    const world = createWorld({ seed: 44, arena: classicArena })
    const enemy = world.snakes.find((snake) => snake.control === 'enemy')
    if (!enemy) {
      throw new Error('expected a wandering bug')
    }
    // Keep only the bug, so the running fight cannot change the count.
    world.snakes = [enemy]
    const before = new Set(world.snakes.map((snake) => snake.id))
    killSnake(world, enemy)
    expect(enemy.alive).toBe(false)

    for (let index = 0; index <= BALANCE.enemyRespawnSec * BALANCE.tickRate + 5; index += 1) {
      tickWorld(world, STEP)
    }

    expect(world.snakes.some((snake) => snake.control === 'enemy' && !before.has(snake.id))).toBe(
      true,
    )
  })

  it('rolls a drop per part, never apples, when a bug dies', () => {
    const lucky = createWorld({ seed: 46, arena: classicArena })
    const luckyEnemy = lucky.snakes.find((snake) => snake.control === 'enemy')
    if (!luckyEnemy) {
      throw new Error('expected a wandering bug')
    }
    const parts = luckyEnemy.segments.length
    lucky.pickups = []
    lucky.rng.next = () => 0.1
    killSnake(lucky, luckyEnemy)

    expect(
      lucky.pickups.filter((pickup) => pickup.kind === 'head' || pickup.kind === 'body'),
    ).toHaveLength(parts)
    expect(lucky.pickups.some((pickup) => pickup.kind === 'apple')).toBe(false)

    const unlucky = createWorld({ seed: 47, arena: classicArena })
    const unluckyEnemy = unlucky.snakes.find((snake) => snake.control === 'enemy')
    if (!unluckyEnemy) {
      throw new Error('expected a wandering bug')
    }
    unlucky.pickups = []
    unlucky.rng.next = () => 0.9
    killSnake(unlucky, unluckyEnemy)

    expect(unlucky.pickups).toHaveLength(0)

    // Parts shot off before the kill still roll, so a worn-down long bug drops.
    const worn = createWorld({ seed: 48, arena: classicArena })
    const wornEnemy = worn.snakes.find((snake) => snake.control === 'enemy')
    if (!wornEnemy) {
      throw new Error('expected a wandering bug')
    }
    const wornParts = wornEnemy.segments.length
    for (const segment of wornEnemy.segments) {
      segment.dead = true
    }
    worn.pickups = []
    worn.rng.next = () => 0.1
    killSnake(worn, wornEnemy)

    expect(
      worn.pickups.filter((pickup) => pickup.kind === 'head' || pickup.kind === 'body'),
    ).toHaveLength(wornParts)
  })

  it('keeps a wandering bug on its route past a nearby player', () => {
    const world = createWorld({ seed: 45, arena: classicArena })
    const enemy = world.snakes.find((snake) => snake.control === 'enemy')
    if (!enemy) {
      throw new Error('expected a wandering bug')
    }
    // The player sits behind the bug; a chasing bug would steer the other way.
    for (const other of world.snakes.filter((snake) => isPlayerControl(snake.control))) {
      placeHead(other, 0, -12)
    }
    placeHead(enemy, 0, 0)
    enemy.ai.targetX = 0
    enemy.ai.targetZ = 10
    enemy.ai.retargetAt = world.time + 10

    updateAi(world, enemy)

    expect(enemy.steerZ).toBeGreaterThan(0.5)
  })

  it('makes a bot chase a nearby player for a short run, then rest', () => {
    const world = createWorld({
      seed: 46,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    // Keep only the two snakes the bot could steer at.
    world.snakes = world.snakes.filter((snake) => snake.id === bot.id || snake.id === human.id)
    world.pickups = []
    placeHead(bot, 0, 0)
    placeHead(human, 0, 10)
    bot.ai.retargetAt = world.time + 10

    updateAi(world, bot)

    expect(bot.ai.chaseUntil).toBeGreaterThan(world.time)
    expect(bot.steerZ).toBeGreaterThan(0.5)

    // The chase ran out; the same player is still close but the bot rests.
    world.time = bot.ai.chaseUntil + 0.1
    placeHead(human, 0, -10)
    bot.ai.targetX = 0
    bot.ai.targetZ = 10
    bot.ai.retargetAt = world.time + 10

    updateAi(world, bot)

    expect(bot.ai.chaseRestUntil).toBeGreaterThan(world.time)
    expect(bot.steerZ).toBeGreaterThan(0.5)
  })

  it('leaves rival bots alone instead of orbiting them', () => {
    const world = createWorld({ seed: 46, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const rival = getSnake(world, 'bot-2')
    world.snakes = [bot, rival]
    world.pickups = []
    placeHead(bot, 0, 0)
    placeHead(rival, 0, 10)
    bot.ai.chaseUntil = 0
    bot.ai.chaseRestUntil = 0

    updateAi(world, bot)

    // A rival bot is not bait: chasing another bot made two of them circle.
    expect(bot.ai.chaseUntil).toBe(0)
  })

  it('makes a bot trail a juke instead of turning with it', () => {
    const world = createWorld({
      seed: 48,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = world.snakes.filter((snake) => snake.id === bot.id || snake.id === human.id)
    world.pickups = []
    placeHead(bot, 0, 0)
    placeHead(human, 0, 10)

    updateAi(world, bot)
    expect(bot.steerZ).toBeGreaterThan(0.9)

    // The player jukes sideways. The bot should not swing on the same tick.
    placeHead(human, 10, 10)
    updateAi(world, bot)
    expect(bot.steerZ).toBeGreaterThan(0.9)

    // After its reaction delay it turns onto the new spot.
    for (let index = 0; index < BALANCE.tickRate; index += 1) {
      updateAi(world, bot)
    }
    expect(bot.steerX).toBeGreaterThan(0.5)
  })

  it('keeps a chasing gun bot at full speed until it reaches attack range', () => {
    const world = createWorld({
      seed: 49,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = world.snakes.filter((snake) => snake.id === bot.id || snake.id === human.id)
    world.pickups = []
    placeHead(bot, 0, 0)
    placeHead(human, 0, 6.5)
    bot.segments[0]!.partId = 'gun'
    bot.ai.chaseUntil = world.time + 10
    bot.ai.seenX = 0
    bot.ai.seenZ = 6.5

    updateAi(world, bot)

    expect(Math.hypot(bot.steerX, bot.steerZ)).toBeCloseTo(1)
  })

  it('does not chase players when headless but still fires from an armed body', () => {
    const world = createWorld({
      seed: 49,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = [bot, human]
    world.pickups = []
    placeHead(bot, 0, 0)
    placeHead(human, 0, 10)
    bot.ai.targetX = 10
    bot.ai.targetZ = 0
    bot.ai.retargetAt = world.time + 10
    bot.segments[0]!.dead = true
    bot.segments[1]!.partId = 'gun'
    bot.segments[1]!.angle = 0
    bot.segments[1]!.cooldown = 0
    bot.ai.chaseUntil = world.time + 10
    bot.ai.chaseRestUntil = world.time + 100

    updateAi(world, bot)
    fireAttacks(world, STEP)

    expect(bot.alive).toBe(true)
    expect(bot.ai.seenZ).not.toBe(human.z)
    expect(bot.steerX).toBeGreaterThan(0)
    expect(Math.abs(bot.steerZ)).toBeLessThan(0.01)
    expect(world.events).toContainEqual(
      expect.objectContaining({ type: 'attack', snakeId: bot.id }),
    )
  })

  it('kills a headless bot with only bones instead of letting it chase', () => {
    const world = createWorld({ seed: 49, arena: classicArena })
    const bot = getSnake(world, 'bot-2')
    bot.segments[0]!.dead = true
    for (const segment of bot.segments.slice(1)) {
      segment.partId = 'normal'
    }
    bot.ai.chaseUntil = world.time + 10

    updateAi(world, bot)

    expect(bot.alive).toBe(false)
    expect(world.events).toContainEqual(expect.objectContaining({ type: 'death', snakeId: bot.id }))
  })

  it('makes the boss wander until a player is close, then chase', () => {
    const world = createWorld({ seed: 47, arena: classicArena })
    spawnBoss(world)
    const boss = world.snakes.find((snake) => snake.control === 'boss')
    if (!boss) {
      throw new Error('expected a boss')
    }
    for (const player of world.snakes.filter((snake) => isPlayerControl(snake.control))) {
      placeHead(player, 90, 90)
    }
    placeHead(boss, 0, 0)
    boss.ai.targetX = 0
    boss.ai.targetZ = 10
    boss.ai.retargetAt = world.time + 10

    updateAi(world, boss)

    // Nobody is close, so the boss roams its own route.
    expect(boss.steerZ).toBeGreaterThan(0.5)

    placeHead(getSnake(world, 'bot-1'), 0, 12)
    updateAi(world, boss)

    // A nearby player turns the boss away from its route and onto the chase.
    expect(boss.ai.targetX !== 0 || boss.ai.targetZ !== 10).toBe(true)
    const chaseZ = boss.ai.targetZ
    expect(chaseZ).toBeGreaterThan(0)
  })

  it('starts humans with a head and three normal bodies, bots with random gear', () => {
    const world = createWorld({
      seed: 2,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const human = getSnake(world, 'human')
    expect(human.segments).toHaveLength(BALANCE.food.startSegments)
    expect(human.segments[0]?.slot).toBe('head')
    for (const segment of human.segments.slice(1)) {
      expect(segment).toMatchObject({ slot: 'body', partId: 'normal', dead: false })
    }
    const cap = requirePart('head', DEFAULT_HEAD_ID).score + BALANCE.botGearBonus
    for (const snake of world.snakes.filter((entry) => entry.control === 'bot')) {
      expect(snake.segments).toHaveLength(BALANCE.food.startSegments)
      expect(snake.segments[0]?.slot).toBe('head')
      for (const segment of snake.segments) {
        expect(requirePart(segment.slot, segment.partId).score).toBeLessThanOrEqual(cap)
      }
    }
  })

  it('starts a wandering bug with a head and three bodies', () => {
    const world = createWorld({ seed: 48, arena: classicArena })
    for (const enemy of world.snakes.filter((snake) => snake.control === 'enemy')) {
      expect(enemy.segments).toHaveLength(BALANCE.food.startSegments)
      expect(enemy.segments[0]?.slot).toBe('head')
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

  it('makes a bot stand off and aim at a power-up instead of circling it', () => {
    const world = createWorld({ seed: 53, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const powerup = world.snakes.find((snake) => snake.control === 'powerup')
    if (!powerup) {
      throw new Error('expected a power-up')
    }
    world.snakes = [bot, powerup]
    world.pickups = []
    // A ranged head can target the crate.
    const gun = requirePart('head', 'gun')
    const head = bot.segments[0]!
    head.partId = 'gun'
    head.hp = gun.hp
    head.maxHp = gun.hp
    placeHead(powerup, 0, 18)
    placeHead(bot, 0, 0)
    bot.angle = 0
    bot.ai.chaseRestUntil = world.time + 20

    updateAi(world, bot)

    // Far away it closes in at full speed.
    expect(bot.steerZ).toBeCloseTo(1, 5)

    placeHead(bot, 0, 12.5)
    bot.angle = Math.PI
    updateAi(world, bot)

    // In range it turns toward the crate but barely moves.
    expect(bot.steerZ).toBeGreaterThan(0)
    expect(Math.hypot(bot.steerX, bot.steerZ)).toBeLessThan(0.01)
    for (let index = 0; index < 20; index += 1) {
      updateMovement(bot, classicArena.width / 2, classicArena.depth / 2, STEP)
    }
    expect(Math.abs(bot.angle)).toBeLessThan(0.2)
    expect(Math.hypot(bot.x, bot.z - 12.5)).toBeLessThan(0.1)
  })

  it('makes a bot run from the human while it is hunting a power-up', () => {
    const world = createWorld({ seed: 54, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const human = getSnake(world, 'bot-2')
    human.control = 'human'
    const powerup = world.snakes.find((snake) => snake.control === 'powerup')
    if (!powerup) {
      throw new Error('expected a power-up')
    }
    world.snakes = [bot, human, powerup]
    world.pickups = []
    // The crate is far enough from the human to still be worth farming.
    placeHead(powerup, 0, 42)
    placeHead(bot, 0, 24)
    placeHead(human, 0, 28)
    bot.angle = 0
    bot.ai.chaseRestUntil = world.time + 20

    updateAi(world, bot)

    // The human is too close, so the bot backs away instead of shooting.
    expect(bot.steerZ).toBeLessThan(-0.5)
  })

  it('keeps hunting a power-up when only another bot is close', () => {
    const world = createWorld({ seed: 54, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const rival = getSnake(world, 'bot-2')
    const powerup = world.snakes.find((snake) => snake.control === 'powerup')
    if (!powerup) {
      throw new Error('expected a power-up')
    }
    world.snakes = [bot, rival, powerup]
    world.pickups = []
    // A gun head so the crate is worth farming.
    const gun = requirePart('head', 'gun')
    bot.segments[0]!.partId = 'gun'
    bot.segments[0]!.hp = gun.hp
    bot.segments[0]!.maxHp = gun.hp
    placeHead(powerup, 0, 30)
    placeHead(bot, 0, 20)
    placeHead(rival, 0, 22)
    bot.angle = 0
    bot.ai.chaseRestUntil = world.time + 20

    updateAi(world, bot)

    // No panic: the bot walks on to the crate instead of bouncing around it.
    expect(bot.steerZ).toBeGreaterThan(0.5)
  })

  it('limits bot power-up hunting to 20 units and head weapons', () => {
    const world = createWorld({ seed: 56, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const powerup = world.snakes.find((snake) => snake.control === 'powerup')
    if (!powerup) {
      throw new Error('expected a power-up')
    }
    world.snakes = [bot, powerup]
    world.pickups = []
    bot.segments[0]!.partId = DEFAULT_HEAD_ID
    bot.segments[1]!.partId = 'gun'
    bot.ai.targetX = 10
    bot.ai.targetZ = 0
    bot.ai.retargetAt = world.time + 10
    bot.ai.chaseRestUntil = world.time + 20
    placeHead(bot, 0, 0)
    placeHead(powerup, 0, 10)

    updateAi(world, bot)

    expect(bot.steerX).toBeGreaterThan(0.5)
    expect(Math.abs(bot.steerZ)).toBeLessThan(0.01)

    bot.segments[0]!.partId = 'gun'
    placeHead(powerup, 0, 21)
    updateAi(world, bot)

    expect(bot.steerX).toBeGreaterThan(0.5)
    expect(Math.abs(bot.steerZ)).toBeLessThan(0.01)
  })

  it('makes a boss hunt a nearby power-up but wander when it is out of range', () => {
    const world = createWorld({ seed: 55, arena: classicArena })
    const boss = spawnBoss(world)
    const powerup = spawnPowerup(world)
    world.snakes = [boss, powerup]
    boss.segments[0]!.partId = DEFAULT_HEAD_ID
    boss.segments[1]!.partId = 'gun'
    boss.ai.targetX = 20
    boss.ai.targetZ = 0
    boss.ai.retargetAt = world.time + 10
    placeHead(boss, 0, 0)
    placeHead(powerup, 0, 20)

    updateAi(world, boss)

    expect(boss.steerZ).toBeGreaterThan(0.5)

    placeHead(powerup, 0, 50)
    updateAi(world, boss)

    expect(boss.steerX).toBeGreaterThan(0.5)
    expect(Math.abs(boss.steerZ)).toBeLessThan(0.01)
  })

  it('makes the boss eat dropped gear instead of wandering past it', () => {
    const world = createWorld({ seed: 58, arena: classicArena })
    const boss = spawnBoss(world)
    world.snakes = [boss]
    world.pickups = [createPickup(world, 'body', 0, 18, 'normal')]
    placeHead(boss, 0, 0)

    updateAi(world, boss)

    expect(boss.steerZ).toBeGreaterThan(0.5)
  })

  it('lets the boss collect loot and grow from it', () => {
    const world = createWorld({ seed: 59, arena: classicArena })
    const boss = spawnBoss(world)
    world.snakes = [boss]
    world.pickups = [createPickup(world, 'body', boss.x, boss.z, 'normal')]
    const before = boss.segments.length

    tickWorld(world, STEP)

    expect(boss.segments).toHaveLength(before + 1)
  })

  it('makes the boss leave a player alone after a chase run', () => {
    const world = createWorld({ seed: 57, arena: classicArena })
    const boss = spawnBoss(world)
    const player = getSnake(world, 'bot-1')
    world.snakes = [boss, player]
    world.pickups = []
    placeHead(boss, 0, 0)
    placeHead(player, 0, 12)
    boss.ai.targetX = 0
    boss.ai.targetZ = 10
    boss.ai.retargetAt = world.time + 10

    updateAi(world, boss)
    expect(boss.ai.chaseUntil).toBeGreaterThan(world.time)

    // The chase run timed out, so the boss goes back to its own route.
    boss.ai.chaseUntil = world.time
    boss.ai.chaseRestUntil = world.time + 5
    boss.ai.targetX = 0
    boss.ai.targetZ = 10
    updateAi(world, boss)

    expect(boss.ai.targetX).toBe(0)
    expect(boss.ai.targetZ).toBe(10)
    expect(boss.steerZ).toBeGreaterThan(0.5)
  })

  it("holds within a short claw's attack reach and bites", () => {
    const world = createWorld({
      seed: 49,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = [bot, human]
    world.pickups = []
    human.segments = human.segments.slice(0, 1)
    bot.segments[0]!.partId = 'claw01'
    placeHead(bot, 0, 0)
    placeHead(human, 0, 2.2)
    bot.angle = 0
    human.angle = 0
    bot.segments[0]!.angle = 0
    human.segments[0]!.angle = 0
    updateAi(world, bot)

    expect(Math.hypot(bot.steerX, bot.steerZ)).toBeGreaterThan(0.01)

    placeHead(human, 0, 1.7)
    bot.ai.seenZ = 1.7
    updateAi(world, bot)
    const humanHp = human.segments[0]?.hp ?? 0
    updateContact(world)

    expect(Math.hypot(bot.steerX, bot.steerZ)).toBeLessThan(0.01)
    expect(bot.steerZ).toBeGreaterThan(0)
    expect(human.segments[0]?.hp).toBeLessThan(humanHp)
  })

  it('holds at the actual reach of a long-claw head and attacks', () => {
    const world = createWorld({
      seed: 49,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = [bot, human]
    world.pickups = []
    bot.segments[0]!.partId = 'claw04'
    bot.segments[1]!.partId = 'gun'
    placeHead(bot, 0, 0)
    placeHead(human, 0, 3.8)
    bot.angle = 0
    human.angle = 0
    bot.segments[0]!.angle = 0
    human.segments[0]!.angle = 0
    for (const [index, segment] of human.segments.entries()) {
      segment.x = human.x
      segment.z = human.z - index * BALANCE.headSpacing
      segment.angle = 0
    }

    updateAi(world, bot)
    const humanHp = human.segments.reduce((sum, segment) => sum + segment.hp, 0)
    updateContact(world)

    expect(Math.hypot(bot.steerX, bot.steerZ)).toBeLessThan(0.01)
    expect(human.segments.reduce((sum, segment) => sum + segment.hp, 0)).toBeLessThan(humanHp)
  })

  it('damages a player after chasing into long-claw range', () => {
    const world = createWorld({
      seed: 49,
      arena: classicArena,
      players: [{ id: 'human', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const bot = getSnake(world, 'bot-2')
    const human = getSnake(world, 'human')
    world.snakes = [bot, human]
    world.pickups = []
    bot.segments[0]!.partId = 'claw04'
    bot.segments[1]!.partId = 'gun'
    bot.segments[1]!.cooldown = 100
    placeHead(bot, 0, 0)
    placeHead(human, 0, 10)
    bot.angle = 0
    human.angle = 0
    human.trail = Array.from({ length: 51 }, (_, index) => ({ x: 0, z: 5 + index * 0.1 }))
    let clawHit = false

    for (let index = 0; index < BALANCE.tickRate * 2; index += 1) {
      tickWorld(world, STEP)
      clawHit ||= world.events.some(
        (event) =>
          event.type === 'hit' && event.targetId === human.id && event.attackerId === bot.id,
      )
    }

    expect(clawHit).toBe(true)
  })

  it('does not walk a melee bot into a power-up', () => {
    const world = createWorld({ seed: 57, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const powerup = world.snakes.find((snake) => snake.control === 'powerup')
    if (!powerup) {
      throw new Error('expected a power-up')
    }
    world.snakes = [bot, powerup]
    world.pickups = [createPickup(world, 'apple', 0, -20)]
    bot.segments[0]!.partId = 'claw04'
    bot.ai.chaseRestUntil = world.time + 20
    placeHead(powerup, 0, 30)
    placeHead(bot, 0, 0)
    bot.angle = 0

    updateAi(world, bot)

    // Melee heads skip the crate, so the bot goes for the apple behind it.
    expect(bot.steerZ).toBeLessThan(-0.5)
  })

  it('walks a headless bot around a power-up instead of pressing into it', () => {
    const world = createWorld({ seed: 57, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const powerup = spawnPowerup(world)
    world.snakes = [bot, powerup]
    // A head lies past the crate, so the bot must go around the solid box.
    world.pickups = [createPickup(world, 'head', 0, 20, 'gun')]
    bot.segments[0]!.dead = true
    bot.segments[1]!.partId = 'gun'
    bot.ai.chaseRestUntil = world.time + 20
    placeHead(powerup, 0, 10)
    placeHead(bot, 0, 0)
    bot.angle = 0

    for (let index = 0; index < BALANCE.tickRate * 5; index += 1) {
      tickWorld(world, STEP)
    }

    // It slid past the crate and picked the head up, so it fights again.
    expect(bot.segments[0]?.dead).toBe(false)
  })

  it('leaves a power-up that the human is camping', () => {
    const world = createWorld({ seed: 54, arena: classicArena })
    const bot = getSnake(world, 'bot-1')
    const human = getSnake(world, 'bot-2')
    human.control = 'human'
    const crates = world.snakes.filter((snake) => snake.control === 'powerup').slice(0, 2)
    if (crates.length < 2) {
      throw new Error('expected two power-ups')
    }
    world.snakes = [bot, human, ...crates]
    world.pickups = []
    placeHead(crates[0]!, 0, 30)
    placeHead(crates[1]!, 0, -30)
    placeHead(human, 0, 28)
    placeHead(bot, 0, 0)
    bot.angle = 0
    bot.ai.chaseRestUntil = world.time + 20

    updateAi(world, bot)

    // The human sits by the north crate, so the bot picks the south one.
    expect(bot.steerZ).toBeLessThan(-0.5)
  })

  it('stops a head at a power-up and lets it walk back out', () => {
    const world = createWorld({ seed: 55, arena: classicArena })
    const snake = getSnake(world, 'bot-1')
    const solids = [{ x: 0, z: 8 }]
    const halfWidth = classicArena.width / 2
    const halfDepth = classicArena.depth / 2

    placeHead(snake, 0, 0)
    snake.steerX = 0
    snake.steerZ = 1
    for (let index = 0; index < 90; index += 1) {
      updateMovement(snake, halfWidth, halfDepth, STEP, solids)
    }

    // The crate is solid, so the head stops outside it.
    expect(snake.z).toBeLessThanOrEqual(8 - BALANCE.powerupSolidRadius + 0.01)
    expect(snake.z).toBeGreaterThan(8 - BALANCE.powerupSolidRadius - 1)

    // Standing inside (a spawn overlap) still lets the snake walk away.
    placeHead(snake, 0, 7)
    snake.angle = Math.PI
    snake.steerX = 0
    snake.steerZ = -1
    updateMovement(snake, halfWidth, halfDepth, STEP, solids)
    expect(snake.z).toBeLessThan(7)
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
    world.snakes = world.snakes.filter((snake) => snake.id === boss.id || snake.id === player.id)
    boss.id = 'boss-3'
    boss.x = 0
    boss.z = 0
    boss.segments[0]!.cooldown = 2
    player.x = 0
    player.z = 36
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
    const world = createWorld({
      seed: 8,
      arena: classicArena,
      players: [{ id: 'you', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const player = getSnake(world, 'you')
    // A head picked up during the life must not survive a death.
    player.baseHeadId = 'claw04'
    player.segments[0]!.partId = 'claw04'
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
    expect(player.segments[0]?.partId).toBe(DEFAULT_HEAD_ID)
    expect(player.segments.slice(1).map((segment) => segment.partId)).toEqual(
      Array.from({ length: BALANCE.food.startSegments - 1 }, () => DEFAULT_BODY_ID),
    )
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

  it('throws three to five items around a broken crate', () => {
    for (const seed of [61, 62, 63]) {
      const world = createWorld({ seed, arena: classicArena })
      world.pickups = []
      const crate = spawnPowerup(world)
      const x = crate.x
      const z = crate.z

      killSnake(world, crate)

      const drops = world.pickups
      expect(drops.length).toBeGreaterThanOrEqual(BALANCE.powerupDropCountMin)
      expect(drops.length).toBeLessThanOrEqual(BALANCE.powerupDropCountMax)
      for (const drop of drops) {
        const distance = Math.hypot(drop.x - x, drop.z - z)
        expect(distance).toBeGreaterThanOrEqual(BALANCE.powerupDropMinDistance - 1e-6)
        expect(distance).toBeLessThanOrEqual(BALANCE.powerupDropMaxDistance + 1e-6)
      }
    }
  })

  it('keeps crate loot airborne until it lands', () => {
    const arena = { ...classicArena, enemyCap: 0, powerupTarget: 0, appleTarget: 0 }
    const world = createWorld({
      seed: 66,
      arena,
      players: [{ id: 'you', name: 'You', control: 'human', slot: 0, headId: DEFAULT_HEAD_ID }],
    })
    const human = getSnake(world, 'you')
    const crate = spawnPowerup(world)
    const crateX = crate.x
    const crateZ = crate.z
    killSnake(world, crate)

    const drop = world.pickups[0]
    if (!drop) {
      throw new Error('expected a crate drop')
    }
    expect(drop.fromX).toBeCloseTo(crateX)
    expect(drop.fromZ).toBeCloseTo(crateZ)
    expect(drop.landAt).toBeGreaterThan(world.time)

    // Stand exactly on the landing spot before the item comes down.
    world.snakes = [human]
    world.pickups = [drop]
    placeHead(human, drop.x, drop.z)
    const earlyTicks = Math.ceil(BALANCE.powerupDropFlightSec * BALANCE.tickRate) - 2
    for (let index = 0; index < earlyTicks; index += 1) {
      tickWorld(world, STEP)
    }
    expect(world.pickups).toHaveLength(1)

    for (let index = 0; index < 4; index += 1) {
      tickWorld(world, STEP)
    }
    expect(world.pickups).toHaveLength(0)
  })

  it('keeps power-ups apart, including respawns', () => {
    const world = createWorld({ seed: 56, arena: classicArena })
    const arena = { ...classicArena, enemyCap: 0 }
    world.arena = arena
    world.snakes = world.snakes.filter((snake) => snake.control === 'powerup')
    for (const crate of world.snakes.slice(0, 4)) {
      killSnake(world, crate)
    }

    const ticks = BALANCE.powerupRespawnSec * BALANCE.tickRate * 5
    for (let index = 0; index < ticks; index += 1) {
      tickWorld(world, STEP)
    }

    const crates = world.snakes.filter((snake) => snake.control === 'powerup' && snake.alive)
    expect(crates).toHaveLength(arena.powerupTarget)
    for (const first of crates) {
      for (const second of crates) {
        if (first.id >= second.id) {
          continue
        }
        expect(Math.hypot(first.x - second.x, first.z - second.z)).toBeGreaterThanOrEqual(
          BALANCE.powerupSpacing,
        )
      }
    }
  })

  it('drops exactly ten boss parts, including its head', () => {
    const world = createWorld({ seed: 42, arena: classicArena })
    const boss = spawnBoss(world)
    const headId = boss.segments[0]?.partId

    killSnake(world, boss)

    const loot = world.pickups.filter((pickup) => pickup.kind === 'head' || pickup.kind === 'body')
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
  it('keeps fighting from a body after the head is lost', () => {
    for (const bodyId of ['gun', 'spike01']) {
      const world = createWorld({ seed: 23, arena: classicArena })
      const player = getSnake(world, 'bot-1')
      // Give the snake a body that can fight on without its head.
      player.segments[1]!.partId = bodyId

      damageSegment(world, player, 0, 99, undefined, world.time)

      expect(player.alive).toBe(true)
      expect(player.segments[0]?.dead).toBe(true)
      expect(player.segments[1]?.dead).toBe(false)
    }
  })

  it('dies immediately when its head is lost and no body can attack', () => {
    const world = createWorld({ seed: 24, arena: classicArena })
    const player = getSnake(world, 'bot-1')

    damageSegment(world, player, 0, 99, undefined, world.time)

    expect(player.alive).toBe(false)
    expect(player.segments).toHaveLength(0)
  })

  it('lets a spike body bite a power-up after the head is lost', () => {
    const world = createWorld({ seed: 26, arena: classicArena })
    const snake = getSnake(world, 'bot-1')
    const crate = spawnPowerup(world)
    world.snakes = [snake, crate]
    world.pickups = []

    // Bone head at the front, live spike body beside the crate.
    const head = snake.segments[0]!
    head.dead = true
    head.hp = 0
    head.angle = 0
    const body = snake.segments[1]!
    body.partId = 'spike01'
    body.dead = false
    body.angle = 0
    body.x = 0
    body.z = 1
    crate.x = 1.8
    crate.z = 1
    const crateHead = crate.segments[0]!
    crateHead.x = 1.8
    crateHead.z = 1
    crateHead.angle = 0
    const hp = crateHead.hp

    updateContact(world)

    expect(crateHead.hp).toBe(hp - 1)
  })

  it('brings the head back when a head is collected', () => {
    const world = createWorld({ seed: 25, arena: classicArena })
    const player = getSnake(world, 'bot-1')
    player.segments[1]!.partId = 'gun'
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
    world.snakes = [attacker, target]
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

  it('bursts a hazard shot on a crate instead of flying past it', () => {
    const world = createWorld({ seed: 12, arena: classicArena })
    const shooter = getSnake(world, 'bot-2')
    const crate = spawnPowerup(world)
    world.snakes = [shooter, crate]
    placeHead(crate, 0, 0)
    const part = requirePart('head', 'poison')
    if (part.attack?.kind !== 'projectile' || !part.attack.projectile.onLand) {
      throw new Error('poison head has no area hazard')
    }
    const shot = part.attack.projectile
    const onLand = shot.onLand
    if (!onLand) {
      throw new Error('poison head has no area hazard')
    }
    const hp = crate.segments[0]?.hp ?? 0
    world.projectiles.push({
      id: 'poison-shot',
      ownerId: shooter.id,
      partId: 'poison',
      visual: 'poison',
      x: 0,
      y: 0.5,
      z: -6,
      vx: 0,
      vz: shot.speed,
      damage: shot.damage,
      age: 0,
      ttl: shot.ttl,
      landed: false,
      delayLeft: 0,
      onLand,
    })

    for (let index = 0; index < 30; index += 1) {
      updateProjectiles(world, STEP)
    }

    // The shot burst on the crate, so the puddle covers it.
    expect(world.projectiles).toHaveLength(0)
    expect(world.areas).toHaveLength(1)
    expect(Math.abs(world.areas[0]?.z ?? Number.NaN)).toBeLessThan(onLand.radius)
    updateAreas(world, STEP)
    expect(crate.segments[0]?.hp).toBe(hp - shot.damage)
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

  it('keeps a landed poison puddle dangerous after a second', () => {
    const world = createWorld({ seed: 13, arena: classicArena })
    const target = getSnake(world, 'bot-1')
    const part = requirePart('head', 'poison')
    if (part.attack?.kind !== 'projectile' || !part.attack.projectile.onLand) {
      throw new Error('poison head has no area hazard')
    }
    const onLand = part.attack.projectile.onLand
    // The poison decal stays on the floor for three seconds, so the puddle must
    // keep hurting well after the shot lands.
    for (const segment of target.segments) {
      segment.x = 40
      segment.z = 40
    }
    world.areas.push({
      id: 'poison-puddle',
      ownerId: 'bot-2',
      partId: 'poison',
      x: 0,
      z: 0,
      radius: onLand.radius,
      damage: 1,
      duration: onLand.duration,
      age: 0,
    })

    for (let index = 0; index < BALANCE.tickRate; index += 1) {
      updateAreas(world, STEP)
    }
    expect(world.areas).toHaveLength(1)

    placeHead(target, 0, 0)
    const hp = target.segments[0]?.hp ?? 0
    updateAreas(world, STEP)

    expect(target.segments[0]?.hp).toBe(hp - 1)
  })

  it('ticks poison area damage on its interval', () => {
    const world = createWorld({ seed: 13, arena: classicArena })
    const target = getSnake(world, 'bot-1')
    placeHead(target, 0, 0)
    const head = target.segments[0]!
    head.hp = 10
    head.maxHp = 10
    world.areas.push({
      id: 'poison-puddle',
      ownerId: 'bot-2',
      partId: 'poison',
      x: 0,
      z: 0,
      radius: 3,
      damage: 1,
      duration: 3,
      age: 0,
      interval: 0.75,
      nextTickAge: 0,
    })

    // Half a second in, the puddle has only ticked once.
    for (let index = 0; index < Math.round(0.5 / STEP); index += 1) {
      world.time += STEP
      updateAreas(world, STEP)
    }
    expect(head.hp).toBe(9)

    // Past 0.75s the second tick lands, so it is not damage every frame.
    for (let index = 0; index < Math.round(0.8 / STEP); index += 1) {
      world.time += STEP
      updateAreas(world, STEP)
    }
    expect(head.hp).toBe(8)
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
