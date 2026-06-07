import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const domainsRoot = resolve(root, 'electron/domains')

interface Finding {
  file: string
  schemaImport: boolean
  databaseServiceImport: boolean
  inlineDbCalls: number
}

function normalize(file: string) {
  return relative(root, file).split(sep).join('/')
}

function isTestFile(file: string) {
  const rel = normalize(file)
  return rel.includes('/__tests__/') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

const findings: Finding[] = []

for (const file of walk(domainsRoot)) {
  const rel = normalize(file)
  if (isTestFile(file)) continue
  if (!rel.includes('/controller/') && !rel.endsWith('/controller.ts')) continue

  const content = readFileSync(file, 'utf8')
  const inlineDbCalls = [...content.matchAll(/\bdb\.(?:select|insert|update|delete)\s*\(/g)].length
  const schemaImport = /from\s+['"][^'"]*db\/schema['"]/.test(content)
  const databaseServiceImport = /from\s+['"][^'"]*infra\/database['"]/.test(content)

  if (inlineDbCalls > 0 || schemaImport || databaseServiceImport) {
    findings.push({ file: rel, schemaImport, databaseServiceImport, inlineDbCalls })
  }
}

findings.sort((a, b) => b.inlineDbCalls - a.inlineDbCalls || a.file.localeCompare(b.file))

console.log('# Backend Domain DB Audit')
console.log()
console.log('Non-failing audit of production domain controller files.')
console.log()

if (findings.length === 0) {
  console.log('No domain controllers import database services/schema or call db.* directly.')
} else {
  console.log('| File | Inline db calls | Schema import | DatabaseService import |')
  console.log('| --- | ---: | --- | --- |')
  for (const finding of findings) {
    console.log(
      `| ${finding.file} | ${finding.inlineDbCalls} | ${finding.schemaImport ? 'yes' : 'no'} | ${
        finding.databaseServiceImport ? 'yes' : 'no'
      } |`,
    )
  }
}
