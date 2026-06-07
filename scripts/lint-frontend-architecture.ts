import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const exceptionFile = resolve(root, 'docs/frontend-architecture-exceptions.json')

interface ExceptionRule {
  owner: string
  justification: string
  removalCondition: string
  files?: string[]
  imports?: Array<{ file: string; source: string }>
}

interface ExceptionLedger {
  rules: Record<string, ExceptionRule>
}

interface Violation {
  file: string
  line: number
  rule: string
  message: string
}

const violations: Violation[] = []

function readLedger(): ExceptionLedger {
  if (!existsSync(exceptionFile)) {
    console.error('Missing docs/frontend-architecture-exceptions.json')
    process.exit(1)
  }

  return JSON.parse(readFileSync(exceptionFile, 'utf8')) as ExceptionLedger
}

const ledger = readLedger()

function rel(file: string) {
  return relative(root, file).split(sep).join('/')
}

function normalizePath(value: string) {
  return value.split(sep).join('/')
}

function lineFor(content: string, index: number) {
  return content.slice(0, index).split('\n').length
}

function lineTextFor(content: string, index: number) {
  const start = content.lastIndexOf('\n', index) + 1
  const end = content.indexOf('\n', index)
  return content.slice(start, end === -1 ? content.length : end)
}

function isCommentOnlyMatch(content: string, index: number) {
  const trimmed = lineTextFor(content, index).trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'out' || entry === 'dist' || entry === '.git') continue
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function add(file: string, content: string, index: number, rule: string, message: string) {
  violations.push({ file: rel(file), line: lineFor(content, index), rule, message })
}

function addLedgerViolation(rule: string, message: string) {
  violations.push({ file: rel(exceptionFile), line: 1, rule, message })
}

function isTestOrStory(file: string) {
  const r = rel(file)
  return r.includes('/__tests__/') || /\.(test|spec|stories)\.(ts|tsx)$/.test(r)
}

function resolvedImportPath(file: string, source: string) {
  if (!source.startsWith('.')) return null
  return normalizePath(resolve(dirname(file), source))
}

function importsValueName(importClause: string, name: string) {
  const normalized = importClause.replace(/\btype\s+/g, '')
  const re = new RegExp(`(^|[,{]\\s*)${name}(\\s+as\\s+\\w+)?(?=\\s*[,}])`)
  return re.test(normalized)
}

function filesFor(rule: string) {
  return new Set(ledger.rules[rule]?.files ?? [])
}

function importsFor(rule: string) {
  return new Set((ledger.rules[rule]?.imports ?? []).map((entry) => `${entry.file}|${entry.source}`))
}

function hasFileException(rule: string, file: string) {
  return filesFor(rule).has(file)
}

function hasImportException(rule: string, file: string, source: string) {
  return importsFor(rule).has(`${file}|${source}`)
}

function assertDocumentedRule(rule: string) {
  const entry = ledger.rules[rule]
  if (!entry) {
    addLedgerViolation(rule, `Missing exception rule '${rule}'.`)
    return
  }

  for (const field of ['owner', 'justification', 'removalCondition'] as const) {
    if (!entry[field]?.trim()) {
      addLedgerViolation(rule, `Exception rule '${rule}' is missing ${field}.`)
    }
  }
}

for (const rule of [
  'legacy-pages',
  'legacy-page-imports',
  'renderer-electron-imports',
  'shared-contract-electron-router-compat',
  'raw-window-wanda',
  'direct-orpc-client',
  'unsafe-type-escapes',
]) {
  assertDocumentedRule(rule)
}

const productionFiles = [...walk(resolve(root, 'src')), ...walk(resolve(root, 'shared/contracts'))].filter(
  (file) => !isTestOrStory(file),
)

const currentPageFiles = new Set(
  walk(resolve(root, 'src/pages'))
    .filter((file) => !isTestOrStory(file))
    .map(rel),
)
for (const pageFile of currentPageFiles) {
  if (!hasFileException('legacy-pages', pageFile)) {
    addLedgerViolation('legacy-pages', `${pageFile} is a new src/pages screen. Move it into src/routes or document it.`)
  }
}
for (const pageFile of filesFor('legacy-pages')) {
  if (!currentPageFiles.has(pageFile)) {
    addLedgerViolation('legacy-pages', `${pageFile} is documented as a legacy page but no longer exists.`)
  }
}

const importRe = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
const dynamicImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const windowWandaRe = /\bwindow\.wanda\b/g

for (const file of productionFiles) {
  const relativeFile = rel(file)
  const content = readFileSync(file, 'utf8')

  importRe.lastIndex = 0
  let importMatch: RegExpExecArray | null
  importMatch = importRe.exec(content)
  while (importMatch !== null) {
    const [, typeOnly, importClause, source] = importMatch
    const resolved = resolvedImportPath(file, source)

    if (source.startsWith('@/pages') && !hasImportException('legacy-page-imports', relativeFile, source)) {
      add(
        file,
        content,
        importMatch.index,
        'legacy-page-imports',
        `Production frontend file imports deprecated page module '${source}'. Inline the screen into src/routes or document the temporary proxy.`,
      )
    }

    if (
      (source.includes('/electron/') || resolved?.includes('/electron/')) &&
      !hasFileException('renderer-electron-imports', relativeFile) &&
      !hasFileException('shared-contract-electron-router-compat', relativeFile)
    ) {
      add(
        file,
        content,
        importMatch.index,
        'renderer-electron-imports',
        `Renderer/shared frontend file imports Electron/backend implementation '${source}'. Use shared/contracts or an approved preload/type boundary.`,
      )
    }

    if (
      source === '@/shared/orpc' &&
      !typeOnly &&
      importsValueName(importClause, 'orpc') &&
      !hasFileException('direct-orpc-client', relativeFile)
    ) {
      add(
        file,
        content,
        importMatch.index,
        'direct-orpc-client',
        'Production frontend file imports the raw orpc client. Move access behind a feature hook/helper or document the temporary exception.',
      )
    }

    importMatch = importRe.exec(content)
  }

  dynamicImportRe.lastIndex = 0
  let dynamicMatch: RegExpExecArray | null
  dynamicMatch = dynamicImportRe.exec(content)
  while (dynamicMatch !== null) {
    const source = dynamicMatch[1]
    if (source.startsWith('@/pages') && !hasImportException('legacy-page-imports', relativeFile, source)) {
      add(
        file,
        content,
        dynamicMatch.index,
        'legacy-page-imports',
        `Production frontend file dynamically imports deprecated page module '${source}'. Inline the screen into src/routes or document the temporary proxy.`,
      )
    }
    dynamicMatch = dynamicImportRe.exec(content)
  }

  windowWandaRe.lastIndex = 0
  let windowMatch: RegExpExecArray | null
  windowMatch = windowWandaRe.exec(content)
  while (windowMatch !== null) {
    if (!isCommentOnlyMatch(content, windowMatch.index) && !hasFileException('raw-window-wanda', relativeFile)) {
      add(
        file,
        content,
        windowMatch.index,
        'raw-window-wanda',
        'Production frontend file uses window.wanda directly. Move IPC/native access behind the owning transport or document the temporary exception.',
      )
    }
    windowMatch = windowWandaRe.exec(content)
  }
}

for (const [rule, entry] of Object.entries(ledger.rules)) {
  for (const file of entry.files ?? []) {
    if (!existsSync(resolve(root, file))) {
      addLedgerViolation(rule, `${file} is documented for '${rule}' but no longer exists.`)
    }
  }
}

if (violations.length === 0) {
  console.log('✓ Frontend architecture checks passed.')
} else {
  console.error(`Found ${violations.length} frontend architecture violation(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`)
    console.error(`    ${v.message}\n`)
  }
  process.exit(1)
}
