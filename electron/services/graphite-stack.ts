import * as cp from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import Database, { type Database as BetterSqliteDatabase } from 'better-sqlite3'
import type { GitStatusStack, GitStatusStackBranch } from '../../shared/contracts/git-status'
import { shellEnv } from '../infra/shell-env'
import { log } from '../packages/logger'

// -----------------------------------------------------------------------------
// Graphite stack computation. Runs `gt` on the host against a worktree path
// regardless of where the pod's shell lives — the auth token and the binary
// are host-side, and gt only manipulates plain git refs that the workenv
// adapter sees through the bind-mount.
// -----------------------------------------------------------------------------

const GT_TIMEOUT_MS = 8_000

/** Process-wide cache of the install probe; gt doesn't move between checks. */
let installCache: { value: boolean; expiresAt: number } | null = null
const INSTALL_TTL_MS = 60_000

const execFileAsync = promisify(cp.execFile)

type ExecGtResult = { stdout: string; ok: boolean; missingExecutable: boolean }

async function execGt(args: string[], cwd?: string): Promise<ExecGtResult> {
  try {
    const { stdout } = await execFileAsync('gt', ['--no-interactive', ...args], {
      cwd,
      timeout: GT_TIMEOUT_MS,
      env: shellEnv(),
    })
    return { stdout: stdout.toString(), ok: true, missingExecutable: false }
  } catch (err) {
    log.repo.debug('gt command failed', { args, error: err instanceof Error ? err.message : String(err) })
    return { stdout: '', ok: false, missingExecutable: isMissingExecutableError(err) }
  }
}

async function execGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      timeout: GT_TIMEOUT_MS,
      env: shellEnv(),
    })
    return stdout.toString().trim() || null
  } catch (err) {
    log.repo.debug('git command failed', { args, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export async function isGtInstalled(): Promise<boolean> {
  const now = Date.now()
  if (installCache && installCache.expiresAt > now) return installCache.value
  const result = await execGt(['--version'])
  const installed = result.ok || !result.missingExecutable
  installCache = { value: installed, expiresAt: now + INSTALL_TTL_MS }
  return installed
}

export function isMissingExecutableError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return true
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ENOENT')
}

export interface GraphiteRepoPaths {
  readonly gitCommonDir: string
  readonly repoConfigPath: string
  readonly metadataDbPath: string
}

export async function getGraphiteRepoPaths(repoPath: string): Promise<GraphiteRepoPaths | null> {
  const gitCommonDir = await execGit(['rev-parse', '--git-common-dir'], repoPath)
  if (!gitCommonDir) return null
  const absoluteCommonDir = resolve(repoPath, gitCommonDir)
  return {
    gitCommonDir: absoluteCommonDir,
    repoConfigPath: join(absoluteCommonDir, '.graphite_repo_config'),
    metadataDbPath: join(absoluteCommonDir, '.graphite_metadata.db'),
  }
}

export async function isRepoInitialized(repoPath: string): Promise<boolean> {
  const paths = await getGraphiteRepoPaths(repoPath)
  return !!paths && existsSync(paths.repoConfigPath)
}

interface GraphiteMetadataRow {
  readonly branch_name: string
  readonly parent_branch_name: string | null
}

function readStackFromMetadata(
  metadataDbPath: string,
  trunk: string,
  currentBranch: string | null,
): GitStatusStackBranch[] {
  if (!existsSync(metadataDbPath)) return []

  let db: BetterSqliteDatabase | null = null
  try {
    db = new Database(metadataDbPath, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare('select branch_name, parent_branch_name from branch_metadata')
      .all() as GraphiteMetadataRow[]
    return buildGraphiteStackBranches(rows, trunk, currentBranch)
  } catch (err) {
    log.repo.debug('failed to read Graphite metadata db', {
      metadataDbPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  } finally {
    db?.close()
  }
}

export function buildGraphiteStackBranches(
  rows: readonly GraphiteMetadataRow[],
  trunk: string,
  currentBranch: string | null,
): GitStatusStackBranch[] {
  const parentByBranch = new Map<string, string | null>()
  const childrenByParent = new Map<string, string[]>()
  parentByBranch.set(trunk, null)

  for (const row of rows) {
    parentByBranch.set(row.branch_name, row.parent_branch_name)
    if (!row.parent_branch_name) continue
    const children = childrenByParent.get(row.parent_branch_name) ?? []
    children.push(row.branch_name)
    childrenByParent.set(row.parent_branch_name, children)
  }

  const branches: GitStatusStackBranch[] = []
  const queue: Array<{ name: string; position: number }> = [{ name: trunk, position: 0 }]
  const visited = new Set<string>()

  const drainQueue = () => {
    while (queue.length > 0) {
      const node = queue.shift()!
      if (visited.has(node.name)) continue
      visited.add(node.name)

      const children = [...(childrenByParent.get(node.name) ?? [])].sort((a, b) => a.localeCompare(b))
      branches.push({
        name: node.name,
        parent: parentByBranch.get(node.name) ?? null,
        position: node.position,
        children,
        isCurrent: node.name === currentBranch,
      })

      for (const child of children) {
        queue.push({ name: child, position: node.position + 1 })
      }
    }
  }

  drainQueue()

  const orphanRoots = [...parentByBranch.keys()].filter((name) => !visited.has(name)).sort((a, b) => a.localeCompare(b))
  for (const name of orphanRoots) {
    const parent = parentByBranch.get(name)
    const position =
      parent && visited.has(parent) ? (branches.find((branch) => branch.name === parent)?.position ?? 0) + 1 : 1
    queue.push({ name, position })
    drainQueue()
  }

  return branches
}

export interface ComputeStackInput {
  readonly enabled: boolean
  readonly repoPath: string
  readonly currentBranch: string | null
}

export async function computeStack({
  enabled,
  repoPath,
  currentBranch,
}: ComputeStackInput): Promise<GitStatusStack | null> {
  if (!enabled) return null

  const installed = await isGtInstalled()
  if (!installed) {
    return {
      enabled: true,
      installed: false,
      initialized: false,
      trunk: null,
      current: currentBranch,
      branches: [],
      updatedAt: Date.now(),
    }
  }

  const repoPaths = await getGraphiteRepoPaths(repoPath)
  const initialized = !!repoPaths && existsSync(repoPaths.repoConfigPath)
  if (!initialized) {
    return {
      enabled: true,
      installed: true,
      initialized: false,
      trunk: null,
      current: currentBranch,
      branches: [],
      updatedAt: Date.now(),
    }
  }

  const trunkRes = await execGt(['trunk'], repoPath)
  const trunk = trunkRes.ok ? trunkRes.stdout.trim() || null : null
  if (!trunk) {
    return {
      enabled: true,
      installed: true,
      initialized: true,
      trunk: null,
      current: currentBranch,
      branches: [],
      updatedAt: Date.now(),
    }
  }

  const branches = repoPaths ? readStackFromMetadata(repoPaths.metadataDbPath, trunk, currentBranch) : []
  branches.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  return {
    enabled: true,
    installed: true,
    initialized: true,
    trunk,
    current: currentBranch,
    branches,
    updatedAt: Date.now(),
  }
}
