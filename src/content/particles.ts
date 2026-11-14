import { z } from 'zod'

const record = z.record(z.string(), z.unknown())

export const quarksDocumentSchema = z
  .object({
    metadata: z.object({ version: z.number(), type: z.literal('Object') }).passthrough(),
    object: z.object({ type: z.string(), children: z.array(z.unknown()).optional() }).passthrough(),
    images: z.array(record).optional(),
  })
  .passthrough()
  .superRefine((document, context) => {
    if (document.object.type !== 'Group' && document.object.type !== 'Scene') {
      context.addIssue({
        code: 'custom',
        path: ['object', 'type'],
        message: 'root must be a Three.js Group or Scene',
      })
    }
    const hasEmitter = (node: unknown): boolean => {
      if (!node || typeof node !== 'object') return false
      const object = node as Record<string, unknown>
      return (
        object.type === 'ParticleEmitter' ||
        (Array.isArray(object.children) && object.children.some(hasEmitter))
      )
    }
    if (!hasEmitter(document.object)) {
      context.addIssue({
        code: 'custom',
        path: ['object', 'children'],
        message: 'document must contain a Quarks ParticleEmitter',
      })
    }
    for (const [index, image] of (document.images ?? []).entries()) {
      const url = image.url
      const dataTexture =
        url !== null &&
        typeof url === 'object' &&
        Array.isArray((url as Record<string, unknown>).data) &&
        Number.isInteger((url as Record<string, unknown>).width) &&
        Number.isInteger((url as Record<string, unknown>).height) &&
        typeof (url as Record<string, unknown>).type === 'string'
      const safeUrl = (value: unknown): boolean =>
        typeof value === 'string' &&
        (value.startsWith('data:image/') ||
          value.startsWith('assets/') ||
          value.startsWith('./assets/') ||
          value.startsWith('https://'))
      if (!dataTexture && !(Array.isArray(url) ? url.every(safeUrl) : safeUrl(url))) {
        context.addIssue({
          code: 'custom',
          path: ['images', index, 'url'],
          message: 'texture must be embedded or use a relative project URL/HTTPS URL',
        })
      }
    }
  })

export type QuarksDocument = z.infer<typeof quarksDocumentSchema>

export function parseQuarksDocument(value: unknown): QuarksDocument {
  return quarksDocumentSchema.parse(value)
}
