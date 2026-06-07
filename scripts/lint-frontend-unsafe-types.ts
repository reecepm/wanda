import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const exceptionFile = resolve(root, 'docs/frontend-architecture-exceptions.json')
const ruleName = 'unsafe-type-escapes'

interface ExceptionRule {
  owner: string
  justification: string
  removalCondition: string
  files?: string[]
}

interface ExceptionLedger {
  rules: Record<string, ExceptionRule>
}

interface Finding {
  file: string
  line: number
  kind: string
}

function rel(file: string) {
  return relative(root, file).split(sep).join('/')
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

function isExcludedFile(file: string) {
  const r = rel(file)
  return (
    r.includes('/__tests__/') ||
    /\.(test|spec|stories)\.(ts|tsx)$/.test(r) ||
    r === 'src/routeTree.gen.ts' ||
    r === 'src/test-hooks.ts'
  )
}

function readLedger(): ExceptionLedger {
  if (!existsSync(exceptionFile)) {
    console.error('Missing docs/frontend-architecture-exceptions.json')
    process.exit(1)
  }
  return JSON.parse(readFileSync(exceptionFile, 'utf8')) as ExceptionLedger
}

function addMatches(file: string, content: string, re: RegExp, kind: string, findings: Finding[]) {
  re.lastIndex = 0
  let match: RegExpExecArray | null
  match = re.exec(content)
  while (match !== null) {
    if (!isCommentOnlyMatch(content, match.index)) {
      findings.push({ file: rel(file), line: lineFor(content, match.index), kind })
    }
    match = re.exec(content)
  }
}

const ledger = readLedger()
const rule = ledger.rules[ruleName]
if (!rule) {
  console.error(`Missing exception rule '${ruleName}' in docs/frontend-architecture-exceptions.json`)
  process.exit(1)
}

const documented = new Set(rule.files ?? [])
const files = walk(resolve(root, 'src')).filter((file) => !isExcludedFile(file) && !file.endsWith('.d.ts'))

const findings: Finding[] = []
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  addMatches(file, content, /@ts-(?:ignore|expect-error|nocheck)\b/g, '@ts-ignore-or-expect-error', findings)
  addMatches(file, content, /\bas\s+unknown\s+as\b/g, 'as-unknown-as', findings)
  addMatches(file, content, /\bas\s+any\b/g, 'as-any', findings)
  addMatches(file, content, /[:<,]\s*any\b|\bany\s*\[\]/g, 'explicit-any', findings)
}

const filesWithFindings = new Set(findings.map((finding) => finding.file))
const violations: string[] = []

for (const file of filesWithFindings) {
  if (!documented.has(file)) {
    const first = findings.find((finding) => finding.file === file)
    violations.push(
      `${file}:${first?.line ?? 1} has unsafe typing (${first?.kind ?? 'unknown'}). Replace it or document it under '${ruleName}'.`,
    )
  }
}

for (const file of documented) {
  if (!existsSync(resolve(root, file))) {
    violations.push(`${file} is documented under '${ruleName}' but no longer exists.`)
  } else if (!filesWithFindings.has(file)) {
    violations.push(`${file} is documented under '${ruleName}' but no unsafe typing pattern was found.`)
  }
}

if (violations.length === 0) {
  console.log(`✓ Frontend unsafe type budget passed (${filesWithFindings.size} documented file(s)).`)
} else {
  console.error(`Found ${violations.length} frontend unsafe type budget violation(s):\n`)
  for (const violation of violations) {
    console.error(`  ${violation}`)
  }
  process.exit(1)
}
