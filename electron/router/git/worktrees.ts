import { ORPCError } from '@orpc/client'
import { Effect, Either } from 'effect'
import { z } from 'zod'
import { ghGetPRStatus } from '../../domains/git/controller'
import { shellEnv } from '../../infra/shell-env'
import { log } from '../../packages/logger'
import type { AppRouterDeps } from '../index'

type CopyIgnoredResult = {
  copied: string[]
  failed: { path: string; reason: string }[]
  lsError?: string
}

const SKIPPED_COPY_DIRS = new Set([
  '.git',
  'node_modules',
  '.turbo',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
])

const SKIPPED_HIDDEN_FILES = new Set(['.DS_Store', '.git', '.gitignore', '.gitmodules'])

function shouldCopyHiddenFile(relPath: string): boolean {
  const parts = relPath.split(/[\\/]+/)
  const base = parts.at(-1) ?? ''
  if (!base || SKIPPED_HIDDEN_FILES.has(base)) return false
  if (parts.slice(0, -1).some((part) => SKIPPED_COPY_DIRS.has(part))) return false
  return base.startsWith('.')
}

/**
 * Narrow a value thrown by `child_process.execFile` into a human-friendly
 * message. execFile enriches the standard Error with `stderr` buffer +
 * `stdout` — prefer the trimmed stderr when present, fall back to the
 * plain error message.
 */
export function execErrorMessage(err: unknown, fallback = 'command failed'): string {
  const commandError = err as { stderr?: unknown; stdout?: unknown; message?: unknown }
  for (const output of [commandError?.stderr, commandError?.stdout]) {
    if (output != null) {
      const asStr = Buffer.isBuffer(output) ? output.toString() : String(output)
      const trimmed = asStr.trim()
      if (trimmed) return trimmed
    }
  }
  if (err instanceof Error && err.message) {
    const message = err.message.trim()
    const prefixMatch = message.match(/^Command failed:[^\n]*\n([\s\S]+)$/)
    if (prefixMatch?.[1]) {
      const trimmed = prefixMatch[1].trim()
      if (trimmed) return trimmed
    }
    return message
  }
  if (typeof commandError?.message === 'string') {
    const trimmed = commandError.message.trim()
    if (trimmed) return trimmed
  }
  return fallback
}

export function normalizePullRequestBaseBranch(baseBranch: string | undefined): string | undefined {
  const trimmed = baseBranch?.trim()
  if (!trimmed) return undefined
  return trimmed
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '')
    .replace(/^origin\//, '')
}

/**
 * Copy ignored files from sourceDir into destDir, honoring root + nested
 * `.gitignore` (plus repo/global excludes) via `git ls-files`. The result
 * surfaces both the ls-files error (if any) and per-file copy failures so
 * callers can decide what to do instead of silently swallowing errors.
 */
async function discoverHiddenFiles(sourceDir: string, destDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const sourceRoot = path.resolve(sourceDir)
  const destRoot = path.resolve(destDir)
  const found: string[] = []

  async function walk(dir: string): Promise<void> {
    const resolvedDir = path.resolve(dir)
    if (resolvedDir === destRoot || resolvedDir.startsWith(`${destRoot}${path.sep}`)) return

    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const rel = path.relative(sourceRoot, fullPath)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue

      if (entry.isDirectory()) {
        if (SKIPPED_COPY_DIRS.has(entry.name)) continue
        await walk(fullPath)
        continue
      }

      if ((entry.isFile() || entry.isSymbolicLink()) && shouldCopyHiddenFile(rel)) {
        found.push(rel)
      }
    }
  }

  await walk(sourceRoot)
  return found
}

export function copyIgnoredFiles(sourceDir: string, destDir: string): Effect.Effect<CopyIgnoredResult> {
  return Effect.gen(function* () {
    const cp = yield* Effect.promise(() => import('node:child_process'))
    const fs = yield* Effect.promise(() => import('node:fs/promises'))
    const path = yield* Effect.promise(() => import('node:path'))
    const { promisify } = yield* Effect.promise(() => import('node:util'))
    const execFileAsync = promisify(cp.execFile)

    const lsEither = yield* Effect.tryPromise({
      try: () =>
        execFileAsync('git', ['-C', sourceDir, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z'], {
          timeout: 15_000,
          maxBuffer: 50 * 1024 * 1024,
        }),
      catch: (err) => new Error(execErrorMessage(err)),
    }).pipe(Effect.either)

    const entries = Either.isRight(lsEither)
      ? lsEither.right.stdout.split('\0').filter((entry) => entry && shouldCopyHiddenFile(entry))
      : []
    const lsError = Either.isLeft(lsEither) ? lsEither.left.message : undefined
    if (lsError) {
      log.repo.warn(`copyIgnoredFiles: git ls-files failed in ${sourceDir}:`, lsError)
    }

    const hiddenFiles = yield* Effect.tryPromise({
      try: () => discoverHiddenFiles(sourceDir, destDir),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    }).pipe(Effect.catchAll(() => Effect.succeed([])))
    // Wholly-ignored directories come back with a trailing slash — skip them.
    const candidates = [...new Set([...entries, ...hiddenFiles])].filter((e) => !e.endsWith('/')).sort()

    const copied: string[] = []
    const failed: { path: string; reason: string }[] = []

    for (const rel of candidates) {
      const src = path.join(sourceDir, rel)
      const dest = path.join(destDir, rel)
      const result = yield* Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path.dirname(dest), { recursive: true })
          await fs.copyFile(src, dest)
        },
        catch: (err) => (err instanceof Error ? err : new Error(String(err))),
      }).pipe(Effect.either)

      if (Either.isRight(result)) {
        copied.push(rel)
      } else {
        const reason = result.left.message
        failed.push({ path: rel, reason })
        log.repo.warn(`copyIgnoredFiles: failed to copy ${rel} → ${dest}:`, reason)
      }
    }

    return { copied, failed, ...(lsError ? { lsError } : {}) }
  })
}

export function gitWorktreeRoutes({ orpc, effectOs, gitStatusBroadcaster }: AppRouterDeps) {
  return {
    gitClone: orpc.input(z.object({ url: z.string(), directory: z.string() })).handler(async ({ input }) => {
      const cp = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(cp.execFile)
      try {
        await execFileAsync('git', ['clone', input.url, input.directory], { timeout: 300_000 })
        return { directory: input.directory }
      } catch (err) {
        throw new Error(execErrorMessage(err, 'git clone failed'))
      }
    }),

    gitWorktreeAdd: orpc
      .input(z.object({ repoPath: z.string(), branch: z.string(), directory: z.string() }))
      .handler(async ({ input }) => {
        const cp = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(cp.execFile)
        try {
          await execFileAsync('git', ['-C', input.repoPath, 'worktree', 'add', input.directory, input.branch], {
            timeout: 30_000,
          })
          return { directory: input.directory }
        } catch (err) {
          throw new Error(execErrorMessage(err, 'git worktree add failed'))
        }
      }),

    gitListLocalBranches: orpc.input(z.object({ repoPath: z.string() })).handler(async ({ input }) => {
      const cp = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(cp.execFile)
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['-C', input.repoPath, 'branch', '-a', '--format=%(refname:short)\t%(HEAD)'],
          { timeout: 10_000 },
        )
        return stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('\t')
            return { name: parts[0]!, current: parts[1] === '*' }
          })
      } catch (err) {
        log.repo.debug('gitListLocalBranches failed', {
          repoPath: input.repoPath,
          error: err instanceof Error ? err.message : String(err),
        })
        return []
      }
    }),

    checkGitHubCli: orpc.handler(async () => {
      const cp = await import('node:child_process')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(cp.execFile)

      let installed = false
      let authenticated = false
      let username: string | undefined

      try {
        await execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 10_000, env: shellEnv() })
        installed = true
        authenticated = true
      } catch (err) {
        // ENOENT = gh not installed. Any other exit means gh ran but auth
        // reported non-zero (typically "not authenticated") — gh itself
        // exists.
        const message = err instanceof Error ? err.message : String(err)
        installed = !message.includes('ENOENT')
      }

      if (authenticated) {
        try {
          const { stdout } = await execFileAsync('gh', ['api', 'user', '-q', '.login'], {
            timeout: 10_000,
            env: shellEnv(),
          })
          username = stdout.trim() || undefined
        } catch (err) {
          log.repo.debug('gh api user failed', { error: err instanceof Error ? err.message : String(err) })
        }
      }

      return { installed, authenticated, username }
    }),

    createWorktree: effectOs
      .input(
        z.object({
          repoPath: z.string(),
          branchName: z.string(),
          directory: z.string(),
          branchFrom: z.string().optional(),
          // When true (default), resolve branchFrom against origin/<branchFrom> after
          // fetching — this is the "fork off the base branch as it exists on the
          // remote" workflow. Set false when branchFrom is a local-only branch
          // (e.g. branching off another pod's worktree branch) so the literal
          // branchFrom ref is used instead.
          baseFromRemote: z.boolean().optional(),
          copyHiddenFiles: z.boolean().optional(),
          sourceDir: z.string().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const cp = yield* Effect.promise(() => import('node:child_process'))
        const { promisify } = yield* Effect.promise(() => import('node:util'))
        const execFileAsync = promisify(cp.execFile)

        if (!input.branchFrom) {
          // No silent fallback to repoPath's HEAD: that causes new worktrees to
          // silently fork off whatever branch happens to be checked out in the
          // main repo (e.g. another feature branch), producing surprising PR diffs.
          return yield* Effect.fail(new ORPCError('BAD_REQUEST', { message: 'createWorktree requires branchFrom' }))
        }

        const baseFromRemote = input.baseFromRemote ?? true
        let baseRef = input.branchFrom

        if (baseFromRemote) {
          const fetchEither = yield* Effect.tryPromise({
            try: () =>
              execFileAsync('git', ['-C', input.repoPath, 'fetch', 'origin', input.branchFrom!], {
                timeout: 60_000,
              }),
            catch: (err) => new Error(execErrorMessage(err, 'git fetch failed')),
          }).pipe(Effect.either)

          if (Either.isLeft(fetchEither)) {
            log.repo.warn(
              `createWorktree: fetch origin ${input.branchFrom} failed in ${input.repoPath}, falling back to local ref:`,
              fetchEither.left.message,
            )
          } else {
            // Only switch to the remote-tracking ref if it actually exists now.
            // Branches with no remote counterpart will still use the local name.
            const verifyEither = yield* Effect.tryPromise({
              try: () =>
                execFileAsync(
                  'git',
                  ['-C', input.repoPath, 'rev-parse', '--verify', `refs/remotes/origin/${input.branchFrom}`],
                  { timeout: 5_000 },
                ),
              catch: (err) => new Error(execErrorMessage(err, 'git rev-parse failed')),
            }).pipe(Effect.either)

            if (Either.isRight(verifyEither)) {
              baseRef = `refs/remotes/origin/${input.branchFrom}`
            }
          }
        }

        const args = ['-C', input.repoPath, 'worktree', 'add', input.directory, '-b', input.branchName, baseRef]

        // `git worktree add` failure is fatal — surface it to the caller.
        // Wrap as ORPCError so the real git stderr reaches the client instead
        // of effect-orpc's generic "Internal Server Error" fallback.
        yield* Effect.tryPromise({
          try: () => execFileAsync('git', args, { timeout: 30_000 }),
          catch: (err) =>
            new ORPCError('INTERNAL_SERVER_ERROR', {
              message: execErrorMessage(err, 'git worktree add failed'),
              cause: err,
            }),
        })

        // New branches can inherit upstream tracking from branchFrom (e.g. branch.autoSetupMerge=inherit).
        // Unset it so the branch doesn't track origin/main when it should track origin/<branchName>.
        // Fails harmlessly if no upstream was set.
        yield* Effect.tryPromise({
          try: () => execFileAsync('git', ['-C', input.directory, 'branch', '--unset-upstream'], { timeout: 5_000 }),
          catch: (err) => err as unknown,
        }).pipe(Effect.either)

        let copyResult: CopyIgnoredResult | null = null
        if (input.copyHiddenFiles && input.sourceDir) {
          copyResult = yield* copyIgnoredFiles(input.sourceDir, input.directory)
        }

        return {
          directory: input.directory,
          branchName: input.branchName,
          copyResult,
        }
      }),

    detectWorktree: orpc.input(z.object({ directory: z.string() })).handler(async ({ input }) => {
      const cp = await import('node:child_process')
      const path = await import('node:path')
      const { promisify } = await import('node:util')
      const execFileAsync = promisify(cp.execFile)

      const exec = (args: string[]) =>
        execFileAsync('git', ['-C', input.directory, ...args], { timeout: 10_000 }).then((r) => r.stdout.trim())

      try {
        const [toplevel, gitDir, gitCommonDir, branch] = await Promise.all([
          exec(['rev-parse', '--show-toplevel']),
          exec(['rev-parse', '--git-dir']),
          exec(['rev-parse', '--git-common-dir']),
          exec(['rev-parse', '--abbrev-ref', 'HEAD']),
        ])

        // It's a worktree if git-dir and git-common-dir differ
        const isWorktree = path.resolve(input.directory, gitDir) !== path.resolve(input.directory, gitCommonDir)

        // Derive main repo path from common dir (strip /.git suffix)
        const commonDirResolved = path.resolve(input.directory, gitCommonDir)
        const repoPath = isWorktree ? path.dirname(commonDirResolved) : toplevel

        return {
          repoPath,
          worktreePath: toplevel,
          worktreeBranch: branch,
          isWorktree,
        }
      } catch (err) {
        throw new Error(execErrorMessage(err, 'Not a git repository'))
      }
    }),

    removeWorktree: orpc
      .input(
        z.object({
          repoPath: z.string(),
          directory: z.string(),
          deleteBranch: z.string().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const cp = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(cp.execFile)

        try {
          await execFileAsync('git', ['-C', input.repoPath, 'worktree', 'remove', input.directory], {
            timeout: 30_000,
          })
        } catch (err) {
          throw new Error(execErrorMessage(err, 'git worktree remove failed'))
        }

        if (input.deleteBranch) {
          try {
            await execFileAsync('git', ['-C', input.repoPath, 'branch', '-d', input.deleteBranch], {
              timeout: 10_000,
            })
          } catch (err) {
            log.repo.debug('branch delete is best-effort; failure ignored', {
              branch: input.deleteBranch,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return { removed: true }
      }),

    createPR: orpc
      .input(
        z.object({
          repoPath: z.string(),
          title: z.string(),
          body: z.string().optional(),
          baseBranch: z.string().optional(),
          draft: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }) => {
        const cp = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(cp.execFile)

        const args = ['pr', 'create', '--title', input.title, '--body', input.body ?? '']
        const baseBranch = normalizePullRequestBaseBranch(input.baseBranch)
        if (baseBranch) args.push('--base', baseBranch)
        if (input.draft) args.push('--draft')

        try {
          const { stdout } = await execFileAsync('gh', args, { cwd: input.repoPath, timeout: 30_000, env: shellEnv() })
          const url = stdout.trim()
          const numberMatch = url.match(/\/pull\/(\d+)/)
          // Fan a remote-refresh out to every pod watching this repo so the
          // new PR shows up in the sidebar/topbar/tray immediately.
          gitStatusBroadcaster?.triggerRemoteRefreshForRepo(input.repoPath)
          return { url, number: numberMatch?.[1] ? Number.parseInt(numberMatch[1], 10) : null }
        } catch (err) {
          throw new ORPCError('BAD_REQUEST', {
            message: execErrorMessage(err, 'gh pr create failed'),
            cause: err,
          })
        }
      }),

    getPRStatus: orpc.input(z.object({ repoPath: z.string() })).handler(({ input }) => ghGetPRStatus(input.repoPath)),

    mergePR: orpc
      .input(
        z.object({
          repoPath: z.string(),
          method: z.enum(['squash', 'merge', 'rebase']).optional(),
        }),
      )
      .handler(async ({ input }) => {
        const cp = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(cp.execFile)

        const args = ['pr', 'merge']
        if (input.method === 'squash') args.push('--squash')
        else if (input.method === 'rebase') args.push('--rebase')
        else args.push('--merge')

        try {
          await execFileAsync('gh', args, { cwd: input.repoPath, timeout: 30_000, env: shellEnv() })
          gitStatusBroadcaster?.triggerRemoteRefreshForRepo(input.repoPath)
          return { merged: true }
        } catch (err) {
          throw new Error(execErrorMessage(err, 'gh pr merge failed'))
        }
      }),
  }
}
