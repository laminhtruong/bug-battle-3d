/**
 * Validates the public asset tree:
 * - file names are lowercase kebab-case with a known extension,
 * - every part model referenced by the content registry exists,
 * - every asset file is referenced somewhere in src/.
 *
 * The asset folder is optional while the art pipeline is still being set up.
 */
import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const assetsRoot = path.join(root, 'public', 'assets')
const sourceRoot = path.join(root, 'src')
const namePattern = /^[a-z0-9]+(-[a-z0-9]+)*\.(glb|webp|png|mp3|woff2)$/

const exists = async (target) => {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

/**
 * FBX2glTF writes NaN weights for vertices the source FBX leaves unweighted,
 * and the GPU then drops those triangles. Catch it instead of losing art.
 */
function badWeights(buffer) {
  const jsonLength = buffer.readUInt32LE(12)
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  const binStart = 20 + jsonLength + 8
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const accessor = gltf.accessors[primitive.attributes.WEIGHTS_0]
      if (!accessor || accessor.componentType !== 5126) {
        continue
      }
      const view = gltf.bufferViews[accessor.bufferView]
      const base = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
      const stride = view.byteStride ?? 16
      for (let index = 0; index < accessor.count; index += 1) {
        let sum = 0
        for (let slot = 0; slot < 4; slot += 1) {
          const value = buffer.readFloatLE(base + index * stride + slot * 4)
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            return index
          }
          sum += value
        }
        if (Math.abs(sum - 1) > 0.01) {
          return index
        }
      }
    }
  }
  return undefined
}

async function listFiles(directory, base = directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, base)))
    } else {
      files.push(path.relative(base, fullPath).replaceAll('\\', '/'))
    }
  }
  return files
}

if (!(await exists(assetsRoot))) {
  console.warn('public/assets does not exist yet; skipping asset check')
  process.exit(0)
}

const problems = []
const assetFiles = await listFiles(assetsRoot)
const referenced = new Set()

for (const file of assetFiles) {
  if (!namePattern.test(path.basename(file))) {
    problems.push(`${file}: file name must be lowercase kebab-case`)
  }
  referenced.add(file)
}

const sourceFiles = (await listFiles(sourceRoot)).filter((file) => /\.(ts|json)$/.test(file))
const sourceText = (
  await Promise.all(sourceFiles.map((file) => readFile(path.join(sourceRoot, file), 'utf8')))
).join('\n')

for (const model of sourceText.matchAll(/["']?model["']?\s*:\s*["']([a-z0-9-]+)["']/g)) {
  const id = model[1]
  const candidates = [`models/parts/head/${id}.glb`, `models/parts/body/${id}.glb`]
  if (!candidates.some((candidate) => referenced.has(candidate))) {
    problems.push(`content model "${id}" is missing from public/assets`)
  }
}

for (const file of assetFiles.filter((name) => name.endsWith('.glb'))) {
  const index = badWeights(await readFile(path.join(assetsRoot, file)))
  if (index !== undefined) {
    problems.push(`${file}: vertex ${index} has invalid skin weights`)
  }
}

const usedAssets = assetFiles.filter((file) => sourceText.includes(path.parse(file).name))
for (const file of assetFiles) {
  if (!usedAssets.includes(file)) {
    console.warn(`unreferenced asset: ${file}`)
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log(`checked ${assetFiles.length} asset files`)
