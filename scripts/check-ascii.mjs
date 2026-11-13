/**
 * Fails when a source file contains non-ASCII characters or when a file name
 * is not kebab-case. Non-ASCII text is only allowed in translations.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url))
const filePattern = /^[a-z0-9]+(-[a-z0-9]+)*\.(ts|json)$/
const problems = []

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath)
      continue
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.json')) {
      continue
    }

    const relative = path.relative(sourceRoot, fullPath).replaceAll('\\', '/')
    if (!filePattern.test(entry.name)) {
      problems.push(`${relative}: file name must be kebab-case`)
    }
    if (relative.startsWith('i18n/')) {
      continue
    }

    const lines = (await readFile(fullPath, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if ([...line].some((character) => (character.codePointAt(0) ?? 0) > 0x7f)) {
        problems.push(`${relative}:${index + 1}: non-ASCII character`)
      }
    })
  }
}

await walk(sourceRoot)

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exit(1)
}

console.log('source is ASCII-only and kebab-cased')
