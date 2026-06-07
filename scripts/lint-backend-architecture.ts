import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')

interface Violation {
  file: string
  line: number
  rule: string
  message: string
}

const violations: Violation[] = []

function rel(file: string) {
  return relative(root, file).split(sep).join('/')
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

function isAllowedCasualAny(file: string, content: string, index: number) {
  const relativeFile = rel(file)
  const line = lineTextFor(content, index)

  return (
    relativeFile === 'electron/router/index.ts' &&
    line.includes('effectOs: EffectBuilder<any, any, any, any, any, any, AppServices, never>')
  )
}

function isTestFile(file: string) {
  const r = rel(file)
  return r.includes('/__tests__/') || r.endsWith('.test.ts') || r.endsWith('.test.tsx')
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

function normalizePath(value: string) {
  return value.split(sep).join('/')
}

function resolvedImportPath(file: string, source: string) {
  if (!source.startsWith('.')) return null
  return normalizePath(resolve(dirname(file), source))
}

function importsValueName(importClause: string, name: string) {
  const re = new RegExp(`(^|[,{]\\s*)${name}(\\s+as\\s+\\w+)?(?=\\s*[,}])`)
  return re.test(importClause)
}

const importRe = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g

for (const file of walk(root)) {
  if (isTestFile(file)) continue

  const relativeFile = rel(file)
  const content = readFileSync(file, 'utf8')
  const inRouter = relativeFile.startsWith('electron/router/')
  const inSharedContracts = relativeFile.startsWith('shared/contracts/')
  const inProductionBackend =
    relativeFile.startsWith('electron/') &&
    !relativeFile.startsWith('electron/db/migrations/') &&
    !relativeFile.startsWith('electron/mcp/')
  const inDomainOrRouter = relativeFile.startsWith('electron/router/') || relativeFile.startsWith('electron/domains/')
  const inDomainController =
    relativeFile.startsWith('electron/domains/') &&
    (relativeFile.includes('/controller/') || relativeFile.endsWith('/controller.ts'))

  importRe.lastIndex = 0
  let match: RegExpExecArray | null
  match = importRe.exec(content)
  while (match !== null) {
    const [statement, importClause, source] = match
    const resolved = resolvedImportPath(file, source)

    if (inRouter) {
      if (
        source.includes('/db/schema') ||
        resolved?.includes('/electron/db/schema') ||
        source.includes('/infra/database') ||
        resolved?.includes('/electron/infra/database')
      ) {
        add(
          file,
          content,
          match.index,
          'router-no-db-internals',
          `Router imports database internals from '${source}'. Move the query/write behind a domain controller or repository.`,
        )
      }

      if (
        source.includes('/repository') ||
        (resolved?.includes('/electron/domains/') && resolved.includes('/repository'))
      ) {
        add(
          file,
          content,
          match.index,
          'router-no-repositories',
          `Router imports repository code from '${source}'. Use a domain controller.`,
        )
      }

      if (importsValueName(importClause, 'DatabaseService')) {
        add(
          file,
          content,
          match.index,
          'router-no-database-service',
          `Router imports DatabaseService from '${source}'. Move DB access behind a domain controller.`,
        )
      }

      if (importsValueName(importClause, 'AppRuntime')) {
        add(
          file,
          content,
          match.index,
          'router-no-app-runtime',
          `Router imports AppRuntime from '${source}'. Use effect-orpc with injected services instead of manual runtime access.`,
        )
      }

      if (statement.includes('AppRuntime') && /AppRuntime\.(runPromise|runSync)\s*\(/.test(content)) {
        add(
          file,
          content,
          match.index,
          'router-no-manual-runtime',
          'Router manually uses AppRuntime.runPromise/runSync. Use effect-orpc procedures instead.',
        )
      }
    }

    if (inSharedContracts && (source.includes('/electron/domains/') || resolved?.includes('/electron/domains/'))) {
      add(
        file,
        content,
        match.index,
        'contracts-no-electron-domains',
        `Shared contract imports backend domain code from '${source}'. Move the boundary type/schema into shared/contracts.`,
      )
    }

    if (inDomainController && (source.includes('/db/schema') || resolved?.includes('/electron/db/schema'))) {
      add(
        file,
        content,
        match.index,
        'domain-controller-no-schema-import',
        `Domain controller imports database schema from '${source}'. Export row/update types and query helpers from the domain repository instead.`,
      )
    }
    match = importRe.exec(content)
  }

  if (inProductionBackend) {
    const unsafePatterns: Array<[RegExp, string, string]> = [
      [
        /\bGenerator<any\b/g,
        'backend-no-generator-any',
        'Production backend code uses Generator<any>. Prefer inferred Effect generators or precise types.',
      ],
      [
        /\bORPCError<any\b/g,
        'backend-no-orpcerror-any',
        'Production backend code uses ORPCError<any>. Use a precise ORPCError type or avoid the annotation.',
      ],
      [
        /(?:\b[A-Za-z_$][\w$]*<any\b|\bas\s+any\b|:\s*any\b|=\s*any\b|\bArray<any\b|\bRecord<[^>\n]*\bany\b|\bany\[\])/g,
        'backend-no-casual-any',
        'Production backend code uses casual any. Replace it with a precise type, unknown plus parsing, or a documented boundary type.',
      ],
      [
        /@ts-ignore|@ts-expect-error/g,
        'backend-no-ts-suppression',
        'Production backend code suppresses TypeScript. Replace with precise typing or document an approved exception.',
      ],
    ]
    for (const [pattern, rule, message] of unsafePatterns) {
      pattern.lastIndex = 0
      let unsafe: RegExpExecArray | null
      unsafe = pattern.exec(content)
      while (unsafe !== null) {
        if (
          rule !== 'backend-no-casual-any' ||
          (!isCommentOnlyMatch(content, unsafe.index) && !isAllowedCasualAny(file, content, unsafe.index))
        ) {
          add(file, content, unsafe.index, rule, message)
        }
        unsafe = pattern.exec(content)
      }
    }

    if (inDomainOrRouter) {
      const unknownCastPattern = /as\s+unknown\s+as/g
      unknownCastPattern.lastIndex = 0
      let unknownCast: RegExpExecArray | null
      unknownCast = unknownCastPattern.exec(content)
      while (unknownCast !== null) {
        add(
          file,
          content,
          unknownCast.index,
          'backend-no-unknown-double-cast',
          'Production domain/router code uses as unknown as. Replace with precise parsing, a typed boundary helper, or a direct brand cast.',
        )
        unknownCast = unknownCastPattern.exec(content)
      }
    }

    if (inDomainController) {
      const inlineDbCallPattern = /\bdb\.(?:select|insert|update|delete)\s*\(/g
      inlineDbCallPattern.lastIndex = 0
      let inlineDbCall: RegExpExecArray | null
      inlineDbCall = inlineDbCallPattern.exec(content)
      while (inlineDbCall !== null) {
        add(
          file,
          content,
          inlineDbCall.index,
          'domain-controller-no-inline-db',
          'Domain controller calls db.select/insert/update/delete directly. Move the database interaction behind a domain repository helper.',
        )
        inlineDbCall = inlineDbCallPattern.exec(content)
      }
    }
  }
}

if (violations.length === 0) {
  console.log('✓ Backend architecture checks passed.')
} else {
  console.error(`Found ${violations.length} backend architecture violation(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.rule}]`)
    console.error(`    ${v.message}\n`)
  }
  process.exit(1)
}
