import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type SourceMap = {
  mappings: string
  sources: string[]
  sourcesContent?: Array<string | null>
}

const assetDir = process.argv[2] ?? 'dist-web/assets'
const ignoredDirs = new Set(['.git', 'dist-web', 'node_modules', 'out', 'release', 'test-results'])
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css'])
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'bun:sqlite'])

function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = []
  let generatedColumn = 0
  let sourceIndex = 0
  let sourceLine = 0
  let sourceColumn = 0
  let nameIndex = 0
  let line: number[][] = []

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const values = new Map([...chars].map((char, index) => [char, index]))

  const readVlq = (index: number): [number, number] => {
    let result = 0
    let shift = 0
    let continuation = true

    while (continuation) {
      const digit = values.get(mappings[index])
      if (digit === undefined) {
        throw new Error(`Invalid sourcemap VLQ character: ${mappings[index]}`)
      }
      index += 1
      continuation = (digit & 32) !== 0
      result += (digit & 31) << shift
      shift += 5
    }

    const negate = (result & 1) === 1
    result >>= 1
    return [negate ? -result : result, index]
  }

  let index = 0
  while (index < mappings.length) {
    const char = mappings[index]
    if (char === ';') {
      lines.push(line)
      line = []
      generatedColumn = 0
      index += 1
      continue
    }
    if (char === ',') {
      index += 1
      continue
    }

    let value = 0
    ;[value, index] = readVlq(index)
    generatedColumn += value
    const segment = [generatedColumn]

    if (index < mappings.length && mappings[index] !== ',' && mappings[index] !== ';') {
      ;[value, index] = readVlq(index)
      sourceIndex += value
      ;[value, index] = readVlq(index)
      sourceLine += value
      ;[value, index] = readVlq(index)
      sourceColumn += value
      segment.push(sourceIndex, sourceLine, sourceColumn)

      if (index < mappings.length && mappings[index] !== ',' && mappings[index] !== ';') {
        ;[value, index] = readVlq(index)
        nameIndex += value
        segment.push(nameIndex)
      }
    }

    line.push(segment)
  }
  lines.push(line)

  return lines
}

function byteSize(value: string): number {
  return Buffer.byteLength(value)
}

function formatKiB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function fileExtension(path: string): string {
  const index = path.lastIndexOf('.')
  return index === -1 ? '' : path.slice(index)
}

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue
    }

    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path, files)
      continue
    }

    if (sourceExtensions.has(fileExtension(entry.name))) {
      files.push(path)
    }
  }

  return files
}

function packageKey(source: string): string {
  if (source.includes('node_modules/')) {
    const rest = source.split('node_modules/').pop() ?? source
    const parts = rest.split('/')
    return parts[0]?.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] || 'node_modules'
  }

  if (source.includes('/packages/')) {
    const rest = source.split('/packages/')[1]
    return `packages/${rest.split('/')[0]}`
  }

  if (source.includes('/src/')) {
    const rest = source.split('/src/')[1]
    return `src/${rest.split('/')[0]}`
  }

  if (source.includes('/shared/')) {
    return 'shared'
  }

  return 'app'
}

function analyzeMaps(): void {
  if (!existsSync(assetDir)) {
    console.log(`No ${assetDir} directory found. Run bun run web:build first.`)
    return
  }

  const chunks = readdirSync(assetDir)
    .filter((file) => file.endsWith('.js') && existsSync(join(assetDir, `${file}.map`)))
    .map((file) => {
      const js = readFileSync(join(assetDir, file), 'utf8')
      const map = JSON.parse(readFileSync(join(assetDir, `${file}.map`), 'utf8')) as SourceMap
      const packages = new Map<string, number>()
      const sourceBytesByIndex = new Map<number, number>()
      let sourceBytes = 0

      map.sources.forEach((source, index) => {
        const content = map.sourcesContent?.[index] ?? ''
        const bytes = byteSize(content)
        sourceBytes += bytes
        packages.set(packageKey(source), (packages.get(packageKey(source)) ?? 0) + bytes)
      })

      const lines = js.split('\n')
      const decoded = decodeMappings(map.mappings)
      for (let lineIndex = 0; lineIndex < decoded.length; lineIndex += 1) {
        const line = lines[lineIndex] ?? ''
        const segments = decoded[lineIndex].filter((segment) => segment.length >= 4)
        for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
          const segment = segments[segmentIndex]
          const sourceIndex = segment[1]
          const start = segment[0]
          const end = segments[segmentIndex + 1]?.[0] ?? line.length
          if (sourceIndex === undefined || end <= start) {
            continue
          }
          sourceBytesByIndex.set(
            sourceIndex,
            (sourceBytesByIndex.get(sourceIndex) ?? 0) + byteSize(line.slice(start, end)),
          )
        }
      }

      const generatedPackages = new Map<string, number>()
      for (const [sourceIndex, bytes] of sourceBytesByIndex) {
        const source = map.sources[sourceIndex]
        generatedPackages.set(packageKey(source), (generatedPackages.get(packageKey(source)) ?? 0) + bytes)
      }

      return {
        file,
        bytes: statSync(join(assetDir, file)).size,
        gzipBytes: gzipSync(js).byteLength,
        sourceBytes,
        packages: [...packages.entries()].sort((a, b) => b[1] - a[1]),
        generatedPackages: [...generatedPackages.entries()].sort((a, b) => b[1] - a[1]),
      }
    })
    .sort((a, b) => b.bytes - a.bytes)

  console.log('Largest JS chunks')
  for (const chunk of chunks.slice(0, 12)) {
    console.log(
      `\n${chunk.file}: ${formatKiB(chunk.bytes)} min, ${formatKiB(chunk.gzipBytes)} gzip, ${formatKiB(chunk.sourceBytes)} source`,
    )
    for (const [name, bytes] of chunk.generatedPackages.slice(0, 10)) {
      console.log(`  ${formatKiB(bytes).padStart(10)}  ${name}`)
    }
  }

  const assetBytes = readdirSync(assetDir)
    .filter((file) => !file.endsWith('.map'))
    .map((file) => ({ file, bytes: statSync(join(assetDir, file)).size }))
    .sort((a, b) => b.bytes - a.bytes)

  console.log('\nLargest emitted assets')
  for (const asset of assetBytes.slice(0, 16)) {
    console.log(`  ${formatKiB(asset.bytes).padStart(10)}  ${asset.file}`)
  }
}

function dependencyName(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function scanImports(): void {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson
  const manifestDeps = new Set(Object.keys(pkg.dependencies ?? {}))
  const manifestDevDeps = new Set(Object.keys(pkg.devDependencies ?? {}))
  const workspaceDeps = new Set([...manifestDeps, ...manifestDevDeps].filter((name) => name.startsWith('@wanda/')))
  const files = [
    ...walk('src'),
    ...walk('electron'),
    ...walk('packages'),
    ...walk('shared'),
    ...walk('scripts'),
    ...walk('e2e'),
    ...[
      'electron.vite.config.ts',
      'vite.web.config.ts',
      'playwright.config.ts',
      'vitest.config.ts',
      'eslint.config.js',
      'drizzle.config.ts',
    ].filter(existsSync),
  ]
  const importPattern =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^.'"#/][^'"]*|#[^'"]*)['"]|import\(\s*['"]([^.'"#/][^'"]*|#[^'"]*)['"]\s*\)|require\(\s*['"]([^.'"#/][^'"]*|#[^'"]*)['"]\s*\)/g
  const seen = new Set<string>()

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      seen.add(dependencyName(specifier))
    }
  }

  const runtimeUnused = [...manifestDeps].filter((name) => !seen.has(name) && !workspaceDeps.has(name)).sort()
  const devUnused = [...manifestDevDeps].filter((name) => !seen.has(name)).sort()
  const undeclared = [...seen]
    .filter((name) => !manifestDeps.has(name) && !manifestDevDeps.has(name) && !workspaceDeps.has(name))
    .filter((name) => !builtins.has(name) && !name.startsWith('@/') && !name.startsWith('#'))
    .sort()

  console.log('\nPossibly unused runtime dependencies')
  for (const name of runtimeUnused) {
    console.log(`  ${name}`)
  }

  console.log('\nPossibly unused dev dependencies')
  for (const name of devUnused) {
    console.log(`  ${name}`)
  }

  console.log('\nImported but not declared at the root')
  for (const name of undeclared) {
    console.log(`  ${name}`)
  }
}

console.log(`Bundle audit for ${relative(process.cwd(), assetDir)}`)
analyzeMaps()
scanImports()
