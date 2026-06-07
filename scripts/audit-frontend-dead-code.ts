import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const candidateRoots = ['src/features', 'src/ui', 'src/shared', 'src/layout', 'src/stores'].map((path) =>
  resolve(root, path),
)

interface SourceFile {
  abs: string
  rel: string
  content: string
  isTest: boolean
}

interface ExportCandidate {
  file: string
  name: string
  line: number
}

interface ExportFinding extends ExportCandidate {
  localUsage: boolean
  testUsageFiles: number
}

function normalize(file: string) {
  return relative(root, file).split(sep).join('/')
}

function isTestFile(file: string) {
  const rel = normalize(file)
  return rel.includes('/__tests__/') || /\.(test|spec|stories)\.(ts|tsx)$/.test(rel)
}

function walk(dir: string, out: string[] = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'out' || entry === 'dist' || entry === '.git') continue
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

function lineFor(content: string, index: number) {
  return content.slice(0, index).split('\n').length
}

function resolveImport(fromFile: string, source: string, knownFiles: Set<string>) {
  let base: string | null = null
  if (source.startsWith('@/')) {
    base = resolve(root, 'src', source.slice(2))
  } else if (source.startsWith('.')) {
    base = resolve(dirname(fromFile), source)
  }
  if (!base) return null

  const candidates = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]
  return candidates.find((candidate) => knownFiles.has(normalize(candidate))) ?? null
}

function importsFrom(content: string) {
  const sources: string[] = []
  const fromRe = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
  const sideEffectRe = /\bimport\s+['"]([^'"]+)['"]/g
  const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  let match: RegExpExecArray | null
  match = fromRe.exec(content)
  while (match !== null) {
    sources.push(match[1])
    match = fromRe.exec(content)
  }

  match = sideEffectRe.exec(content)
  while (match !== null) {
    sources.push(match[1])
    match = sideEffectRe.exec(content)
  }

  match = dynamicImportRe.exec(content)
  while (match !== null) {
    sources.push(match[1])
    match = dynamicImportRe.exec(content)
  }

  return sources
}

function exportedDeclarations(file: SourceFile): ExportCandidate[] {
  if (basename(file.abs) === 'index.ts' || basename(file.abs) === 'index.tsx') return []

  const candidates: ExportCandidate[] = []
  const declarationRe =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum)\s+([A-Za-z_$][\w$]*)/g

  let match: RegExpExecArray | null
  match = declarationRe.exec(file.content)
  while (match !== null) {
    candidates.push({ file: file.rel, name: match[1], line: lineFor(file.content, match.index) })
    match = declarationRe.exec(file.content)
  }

  return candidates
}

function contentWithoutExportDeclarations(content: string) {
  return content
    .replace(/\bexport\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+['"][^'"]+['"]/g, '')
    .replace(/\bexport\s+(?:type\s+)?\{[\s\S]*?\}/g, '')
    .replace(
      /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|const|let|var|function|enum)\s+[A-Za-z_$][\w$]*/g,
      '',
    )
}

function hasWord(content: string, word: string) {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(content)
}

function isCandidateFile(file: SourceFile) {
  return candidateRoots.some((scanRoot) => file.abs.startsWith(`${scanRoot}${sep}`))
}

const files = walk(resolve(root, 'src'))
  .map<SourceFile>((abs) => ({ abs, rel: normalize(abs), content: readFileSync(abs, 'utf8'), isTest: isTestFile(abs) }))
  .sort((a, b) => a.rel.localeCompare(b.rel))

const knownFiles = new Set(files.map((file) => file.rel))
const productionFiles = files.filter((file) => !file.isTest && !file.rel.endsWith('.d.ts'))
const inboundProduction = new Map<string, Set<string>>()
const inboundTests = new Map<string, Set<string>>()

for (const file of files) {
  for (const source of importsFrom(file.content)) {
    const resolved = resolveImport(file.abs, source, knownFiles)
    if (!resolved) continue
    const rel = normalize(resolved)
    const inbound = file.isTest ? inboundTests : inboundProduction
    const importers = inbound.get(rel) ?? new Set<string>()
    importers.add(file.rel)
    inbound.set(rel, importers)
  }
}

const candidateFiles = productionFiles.filter(isCandidateFile)

const fileCandidates = candidateFiles
  .filter((file) => !file.rel.endsWith('/index.ts') && !file.rel.endsWith('/index.tsx'))
  .filter((file) => !inboundProduction.has(file.rel))
  .map((file) => ({
    file: file.rel,
    testImporters: inboundTests.get(file.rel)?.size ?? 0,
  }))

const usageCorpus = productionFiles.map((file) => ({
  rel: file.rel,
  searchable: contentWithoutExportDeclarations(file.content),
}))

const usageByFile = new Map(usageCorpus.map((file) => [file.rel, file.searchable]))
const testUsageCorpus = files
  .filter((file) => file.isTest)
  .map((file) => ({
    rel: file.rel,
    searchable: contentWithoutExportDeclarations(file.content),
  }))

const exportCandidates: ExportFinding[] = candidateFiles
  .flatMap(exportedDeclarations)
  .filter((candidate) =>
    usageCorpus.every((file) => file.rel === candidate.file || !hasWord(file.searchable, candidate.name)),
  )
  .map((candidate) => ({
    ...candidate,
    localUsage: hasWord(usageByFile.get(candidate.file) ?? '', candidate.name),
    testUsageFiles: testUsageCorpus.filter((file) => hasWord(file.searchable, candidate.name)).length,
  }))

console.log('# Frontend Dead-Code Audit')
console.log()
console.log('Non-failing audit. Treat every item as a deletion/documentation candidate, not as proof of dead code.')
console.log()

if (fileCandidates.length === 0) {
  console.log('No production frontend files without production inbound imports.')
} else {
  console.log('## Production files without production inbound imports')
  console.log()
  console.log('| File | Test importers |')
  console.log('| --- | ---: |')
  for (const candidate of fileCandidates.slice(0, 160)) {
    console.log(`| ${candidate.file} | ${candidate.testImporters} |`)
  }
  if (fileCandidates.length > 160) {
    console.log(`| ... | ${fileCandidates.length - 160} additional candidates omitted |`)
  }
  console.log()
}

if (exportCandidates.length === 0) {
  console.log('No exported frontend declarations without production textual usage.')
} else {
  console.log('## Exported declarations without production textual usage')
  console.log()
  console.log('| File | Line | Export | Local usage | Test usage files |')
  console.log('| --- | ---: | --- | --- | ---: |')
  for (const candidate of exportCandidates.slice(0, 160)) {
    console.log(
      `| ${candidate.file} | ${candidate.line} | ${candidate.name} | ${candidate.localUsage ? 'yes' : 'no'} | ${
        candidate.testUsageFiles
      } |`,
    )
  }
  if (exportCandidates.length > 160) {
    console.log(`| ... | ... | ${exportCandidates.length - 160} additional candidates omitted |`)
  }
}
