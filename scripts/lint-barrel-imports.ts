/**
 * Lint script: enforce that cross-feature imports go through index.ts barrels.
 *
 * Any import matching `@/features/<name>/` from a file OUTSIDE that feature
 * must resolve to `@/features/<name>` (the barrel), not a deep path like
 * `@/features/<name>/components/foo`.
 *
 * Intra-feature imports (relative or absolute) are allowed.
 *
 * Usage: bun scripts/lint-barrel-imports.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const srcDir = resolve(import.meta.dirname, '../src')
const rootDir = resolve(import.meta.dirname, '..')
const exceptionFile = resolve(rootDir, 'docs/frontend-architecture-exceptions.json')
const exceptionRule = 'bundle-split-deep-imports'

interface ExceptionLedger {
  rules?: Record<string, { imports?: Array<{ file: string; source: string }> }>
}

function loadImportExceptions(): Set<string> {
  if (!existsSync(exceptionFile)) {
    return new Set()
  }

  const ledger = JSON.parse(readFileSync(exceptionFile, 'utf8')) as ExceptionLedger
  return new Set(
    (ledger.rules?.[exceptionRule]?.imports ?? []).flatMap((entry) => {
      const srcRelativeFile = entry.file.startsWith('src/') ? entry.file.slice(4) : entry.file
      return [`${entry.file}|${entry.source}`, `${srcRelativeFile}|${entry.source}`]
    }),
  )
}

const importExceptions = loadImportExceptions()

const files = execSync(`find ${srcDir} -type f \\( -name '*.ts' -o -name '*.tsx' \\) ! -path '*/node_modules/*'`, {
  encoding: 'utf-8',
})
  .trim()
  .split('\n')
  .filter(Boolean)

const IMPORT_RE = /from\s+['"]@\/features\/([^/'"]+)\/([^'"]+)['"]/g

interface Violation {
  file: string
  line: number
  feature: string
  deepPath: string
}

const violations: Violation[] = []

for (const file of files) {
  const relFile = relative(srcDir, file)
  const featureMatch = relFile.match(/^features\/([^/]+)\//)
  const ownFeature = featureMatch?.[1] ?? null

  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let match: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((match = IMPORT_RE.exec(line)) !== null) {
      const targetFeature = match[1]
      const deepPath = match[2]

      if (targetFeature === ownFeature) continue

      const source = `@/features/${targetFeature}/${deepPath}`
      if (importExceptions.has(`${relFile}|${source}`)) continue

      violations.push({
        file: relFile,
        line: i + 1,
        feature: targetFeature,
        deepPath,
      })
    }
  }
}

if (violations.length === 0) {
  console.log('✓ All cross-feature imports go through barrel exports.')
  process.exit(0)
} else {
  console.error(`Found ${violations.length} cross-feature deep import(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    imports from @/features/${v.feature}/${v.deepPath}`)
    console.error(`    should import from @/features/${v.feature}\n`)
  }
  process.exit(1)
}
