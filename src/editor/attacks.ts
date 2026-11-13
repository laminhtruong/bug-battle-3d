import type { AttackDef, SpawnPoint } from '@/content/define'

/** Editor-only presets. The saved part keeps only the resulting attack data. */
export interface AttackPreset {
  id: string
  label: string
  create(): AttackDef
}

export const ATTACK_VISUALS = ['bullet', 'poison', 'lightning'] as const

const FORWARD: SpawnPoint = { x: 0, z: 1.96, angle: 0 }
const SIDES: SpawnPoint[] = [
  { x: 1.96, z: 0, angle: 90 },
  { x: -1.96, z: 0, angle: -90 },
]

function projectile(spawnPoints: SpawnPoint[], hazard: boolean): AttackDef {
  return {
    kind: 'projectile',
    cooldown: 1,
    projectile: {
      speed: 5,
      ttl: 0.5,
      visual: 'bullet',
      damage: 1,
      spawnPoints: spawnPoints.map((point) => ({ ...point })),
      ...(hazard ? { onLand: { delay: 0, duration: 0.5, radius: 1.5 } } : {}),
    },
  }
}

export const ATTACK_PRESETS: readonly AttackPreset[] = [
  { id: 'projectile', label: 'Projectile', create: () => projectile([FORWARD], false) },
  { id: 'projectile-sides', label: 'Side projectiles', create: () => projectile(SIDES, false) },
  { id: 'hazard', label: 'Hazard projectile', create: () => projectile([FORWARD], true) },
  { id: 'hazard-sides', label: 'Side hazard projectiles', create: () => projectile(SIDES, true) },
  {
    id: 'cone',
    label: 'Cone',
    create: () => ({
      kind: 'cone',
      cooldown: 1,
      cone: {
        range: 4,
        halfAngleDeg: 25,
        duration: 0.3,
        spawnPoints: [{ x: 0, z: 0, angle: 0 }],
      },
    }),
  },
]

/** The preset a loaded attack most closely matches, for the dropdown. */
export function attackPreset(attack: AttackDef | undefined): string {
  if (!attack) {
    return ''
  }
  if (attack.kind === 'cone') {
    return 'cone'
  }
  const side = attack.projectile.spawnPoints.some((point) => point.angle !== 0)
  return `${attack.projectile.onLand ? 'hazard' : 'projectile'}${side ? '-sides' : ''}`
}
