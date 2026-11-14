import { z } from 'zod'

const pair = z.tuple([z.number().finite(), z.number().finite()])
const color = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
])
const colorPoint = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
])

export const particleSystemSchema = z
  .object({
    duration: z.number().finite().positive(),
    loop: z.boolean().optional(),
    life: pair,
    speed: pair,
    size: pair,
    rotation: pair.optional(),
    gravity: z.number().finite().optional(),
    rate: z.number().finite().min(0).optional(),
    bursts: z
      .array(z.object({ time: z.number().finite().min(0), count: z.number().finite().min(0) }))
      .optional(),
    shape: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('cone'),
        angle: z.number().finite().min(0).max(180),
        radius: z.number().finite().min(0),
        arc: z.number().finite().min(0).max(360).optional(),
      }),
      z.object({ kind: z.literal('sphere'), radius: z.number().finite().min(0) }),
      z.object({
        kind: z.literal('circle'),
        radius: z.number().finite().min(0),
        thickness: z.number().finite().min(0).max(1).optional(),
      }),
      z.object({ kind: z.literal('point') }),
    ]),
    startColor: color.optional(),
    colorOverLife: z
      .object({
        colors: z.array(colorPoint),
        alphas: z.array(pair),
      })
      .optional(),
    sizeOverLife: z.array(pair).optional(),
    stretch: pair.optional(),
    uv: z
      .object({
        x: z.number().int().positive(),
        y: z.number().int().positive(),
        frames: z.number().int().positive(),
        start: z.number().int().min(0),
        cycles: z.number().positive(),
      })
      .optional(),
    material: z.string().regex(/^[a-z0-9-]+$/),
    additive: z.boolean(),
    mode: z.enum(['billboard', 'stretched', 'horizontal']),
    lengthFactor: z.number().finite().optional(),
    speedFactor: z.number().finite().optional(),
    worldSpace: z.boolean().optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    for (const key of ['life', 'speed', 'size'] as const) {
      if (spec[key][0] > spec[key][1]) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'minimum must not exceed maximum',
        })
      }
    }
    for (const [index, burst] of (spec.bursts ?? []).entries()) {
      if (burst.time > spec.duration) {
        context.addIssue({
          code: 'custom',
          path: ['bursts', index, 'time'],
          message: 'burst time must be within duration',
        })
      }
    }
    const curves: { name: string; times: number[] }[] = [
      { name: 'sizeOverLife', times: (spec.sizeOverLife ?? []).map(([time]) => time) },
      {
        name: 'colorOverLife.colors',
        times: spec.colorOverLife?.colors.map(([time]) => time) ?? [],
      },
      {
        name: 'colorOverLife.alphas',
        times: spec.colorOverLife?.alphas.map(([time]) => time) ?? [],
      },
    ]
    for (const { name, times } of curves) {
      let previous = -1
      for (const [index, time] of times.entries()) {
        if (time < 0 || time > 1 || time < previous) {
          context.addIssue({
            code: 'custom',
            path: [name, index],
            message: 'curve keys must be ordered between 0 and 1',
          })
          break
        }
        previous = time
      }
    }
  })

export const particleEffectSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(80),
    systems: z.array(particleSystemSchema).min(1).max(32),
  })
  .strict()

export type ParticleSystemSpec = z.infer<typeof particleSystemSchema>
export type ParticleEffect = z.infer<typeof particleEffectSchema>
