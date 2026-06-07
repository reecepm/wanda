import * as fs from 'node:fs'
import * as path from 'node:path'
import { Context, Effect, Layer } from 'effect'
import yaml from 'js-yaml'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandFileType = 'taskfile' | 'makefile' | 'package-json'

export type DetectedFile = {
  path: string
  type: CommandFileType
  relativePath: string
}

export type CommandArg = {
  name: string
  required: boolean
  default?: string
}

export type DetectedCommand = {
  name: string
  command: string
  description?: string
  args: CommandArg[]
  source: DetectedFile
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

const FILE_PATTERNS: Array<{ glob: string[]; type: CommandFileType }> = [
  { glob: ['Taskfile.yml', 'Taskfile.yaml', 'Taskfile.dist.yml', 'Taskfile.dist.yaml'], type: 'taskfile' },
  { glob: ['Makefile', 'GNUmakefile', 'makefile'], type: 'makefile' },
  { glob: ['package.json'], type: 'package-json' },
]

// ---------------------------------------------------------------------------
// Package manager detection
// ---------------------------------------------------------------------------

function detectPackageManager(dir: string): string {
  if (fs.existsSync(path.join(dir, 'bun.lock')) || fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

interface TaskfileYaml {
  version?: string
  tasks?: Record<string, TaskEntry>
  includes?: Record<string, string | { taskfile: string; dir?: string; aliases?: string[] }>
}

interface TaskEntry {
  desc?: string
  summary?: string
  cmds?: unknown[]
  vars?: Record<string, string | { sh: string } | unknown>
  requires?: { vars?: string[] }
  internal?: boolean
  aliases?: string[]
}

function parseTaskfile(filePath: string, source: DetectedFile, prefix = ''): DetectedCommand[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const raw = yaml.load(content)
  if (!raw || typeof raw !== 'object') return []
  const doc = raw as TaskfileYaml

  const commands: DetectedCommand[] = []

  for (const [taskName, entry] of Object.entries(doc.tasks ?? {})) {
    if (entry.internal) continue
    if (taskName === 'default' && !prefix) continue

    const fullName = prefix ? `${prefix}:${taskName}` : taskName
    const args: CommandArg[] = []

    // Required vars from `requires.vars`
    if (entry.requires?.vars) {
      for (const v of entry.requires.vars) {
        args.push({ name: v, required: true })
      }
    }

    // Optional vars from `vars:` (skip shell-computed ones, skip already-required)
    if (entry.vars) {
      const requiredNames = new Set(args.map((a) => a.name))
      for (const [varName, varValue] of Object.entries(entry.vars)) {
        if (requiredNames.has(varName)) continue
        if (typeof varValue === 'object' && varValue !== null && 'sh' in varValue) continue
        if (typeof varValue === 'string') {
          args.push({ name: varName, required: false, default: varValue })
        }
      }
    }

    commands.push({
      name: fullName,
      command: `task ${fullName}`,
      description: entry.desc,
      args,
      source,
    })
  }

  // Handle includes
  if (doc.includes) {
    const dir = path.dirname(filePath)
    for (const [ns, include] of Object.entries(doc.includes)) {
      const includePath = typeof include === 'string' ? include : include.taskfile
      const resolved = path.resolve(dir, includePath)
      if (!fs.existsSync(resolved)) continue
      try {
        const included = parseTaskfile(resolved, source, ns)
        commands.push(...included)
      } catch {
        // Skip unreadable includes
      }
    }
  }

  return commands
}

function parseMakefile(filePath: string, source: DetectedFile): DetectedCommand[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const commands: DetectedCommand[] = []
  const lines = content.split('\n')

  // Match targets: `target:` or `target: deps` with optional `## description` comment
  const targetRe = /^([a-zA-Z_][a-zA-Z0-9_.-]*)\s*:/
  const skipTargets = new Set([
    '.PHONY',
    '.DEFAULT',
    '.SUFFIXES',
    '.PRECIOUS',
    '.INTERMEDIATE',
    '.SECONDARY',
    '.DELETE_ON_ERROR',
    '.IGNORE',
    '.SILENT',
  ])

  for (const line of lines) {
    const match = targetRe.exec(line)
    const target = match?.[1]
    if (!target) continue
    if (skipTargets.has(target)) continue

    // Check for `## description` comment
    const descMatch = /##\s*(.+)$/.exec(line)
    const description = descMatch?.[1]?.trim()

    commands.push({
      name: target,
      command: `make ${target}`,
      description,
      args: [],
      source,
    })
  }

  return commands
}

function parsePackageJson(filePath: string, source: DetectedFile): DetectedCommand[] {
  const content = fs.readFileSync(filePath, 'utf-8')
  const pkg: { scripts?: Record<string, string> } = JSON.parse(content)
  if (!pkg.scripts) return []

  const pm = detectPackageManager(path.dirname(filePath))

  return Object.entries(pkg.scripts).map(([name, script]) => ({
    name,
    command: `${pm} run ${name}`,
    description: script,
    args: [],
    source,
  }))
}

const PARSERS: Record<CommandFileType, (filePath: string, source: DetectedFile) => DetectedCommand[]> = {
  taskfile: parseTaskfile,
  makefile: parseMakefile,
  'package-json': parsePackageJson,
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CommandParserServiceShape {
  /** Detect command files in a directory (non-recursive) */
  readonly detectFiles: (cwd: string) => Effect.Effect<DetectedFile[]>
  /** Detect command files recursively up to maxDepth */
  readonly detectFilesDeep: (cwd: string, maxDepth?: number) => Effect.Effect<DetectedFile[]>
  /** Parse a detected file into importable commands */
  readonly parseFile: (file: DetectedFile) => Effect.Effect<DetectedCommand[]>
}

export class CommandParserService extends Context.Tag('CommandParserService')<
  CommandParserService,
  CommandParserServiceShape
>() {}

export const CommandParserServiceLive = Layer.succeed(
  CommandParserService,
  CommandParserService.of({
    detectFiles: (cwd) =>
      Effect.sync(() => {
        const results: DetectedFile[] = []
        for (const pattern of FILE_PATTERNS) {
          for (const name of pattern.glob) {
            const fullPath = path.join(cwd, name)
            if (fs.existsSync(fullPath)) {
              results.push({
                path: fullPath,
                type: pattern.type,
                relativePath: name,
              })
            }
          }
        }
        return results
      }),

    detectFilesDeep: (cwd, maxDepth = 5) =>
      Effect.sync(() => {
        const results: DetectedFile[] = []
        const globs = FILE_PATTERNS.flatMap((p) => p.glob.map((g) => ({ name: g, type: p.type })))

        function walk(dir: string, depth: number) {
          if (depth > maxDepth) return
          let entries: fs.Dirent[]
          try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
          } catch {
            return
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
            const fullPath = path.join(dir, entry.name)
            if (entry.isFile()) {
              const match = globs.find((g) => g.name === entry.name)
              if (match) {
                results.push({
                  path: fullPath,
                  type: match.type,
                  relativePath: path.relative(cwd, fullPath),
                })
              }
            } else if (entry.isDirectory()) {
              walk(fullPath, depth + 1)
            }
          }
        }

        walk(cwd, 0)
        return results
      }),

    parseFile: (file) =>
      Effect.sync(() => {
        const parser = PARSERS[file.type]
        return parser(file.path, file)
      }),
  }),
)
