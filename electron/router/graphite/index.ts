import * as cp from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import type { GitStatusStack } from '../../../shared/contracts/git-status'
import { shellEnv } from '../../infra/shell-env'
import { log } from '../../packages/logger'
import { computeStack, isRepoInitialized } from '../../services/graphite-stack'
import type { AppRouterDeps } from '../index'

const execFileAsync = promisify(cp.execFile)

const VERSION_TIMEOUT_MS = 5_000
const REPO_PROBE_TIMEOUT_MS = 5_000
const MUTATION_TIMEOUT_MS = 120_000

interface MutationResult {
  success: boolean
  error?: string
  stdout: string
}

async function runGtMutation(args: string[], repoPath: string): Promise<MutationResult> {
  try {
    const { stdout } = await execFileAsync('gt', ['--no-interactive', ...args], {
      cwd: repoPath,
      timeout: MUTATION_TIMEOUT_MS,
      env: shellEnv(),
      maxBuffer: 8 * 1024 * 1024,
    })
    return { success: true, stdout: stdout.toString() }
  } catch (err) {
    // execFile errors expose stdout/stderr on the error object.
    const e = err as NodeJS.ErrnoException & { stdout?: Buffer | string; stderr?: Buffer | string }
    const stderr = e.stderr ? e.stderr.toString() : ''
    const stdout = e.stdout ? e.stdout.toString() : ''
    const message = stderr.trim() || (err instanceof Error ? err.message : String(err))
    log.repo.warn('gt mutation failed', { args, error: message })
    return { success: false, error: message, stdout }
  }
}

interface InstallStatus {
  installed: boolean
  version: string | null
}

interface RepoStatus {
  initialized: boolean
  trunk: string | null
  authenticated: boolean
}

async function probeInstall(): Promise<InstallStatus> {
  try {
    const { stdout } = await execFileAsync('gt', ['--no-interactive', '--version'], {
      timeout: VERSION_TIMEOUT_MS,
      env: shellEnv(),
    })
    return { installed: true, version: stdout.trim() || null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isMissingExecutableError(err)) {
      return { installed: false, version: null }
    }
    log.repo.debug('gt --version errored but binary exists', { error: message })
    return { installed: true, version: null }
  }
}

export function isMissingExecutableError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  if (code === 'ENOENT') return true
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('ENOENT')
}

async function probeRepo(repoPath: string): Promise<RepoStatus> {
  const initialized = await isRepoInitialized(repoPath)

  let trunk: string | null = null
  let authenticated = false

  if (initialized) {
    try {
      const { stdout } = await execFileAsync('gt', ['--no-interactive', 'trunk'], {
        cwd: repoPath,
        timeout: REPO_PROBE_TIMEOUT_MS,
        env: shellEnv(),
      })
      trunk = stdout.trim() || null
    } catch (err) {
      log.repo.debug('gt trunk failed', {
        repoPath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Auth probe: gt has no JSON status command; the user's token is stored at
  // ~/.graphite_user_config. Treat presence of that file as "auth present".
  // A bad token surfaces later as a submit error — same as gh.
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home) {
    authenticated = existsSync(join(home, '.graphite_user_config'))
  }

  return { initialized, trunk, authenticated }
}

async function getCurrentCommitMessage(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--pretty=%B'], {
      cwd: repoPath,
      timeout: REPO_PROBE_TIMEOUT_MS,
      env: shellEnv(),
    })
    return stdout.trim() || null
  } catch (err) {
    log.repo.debug('git log -1 failed', {
      repoPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export function graphiteRoutes({ orpc, gitStatusBroadcaster }: AppRouterDeps) {
  // Post-mutation hook: prod the broadcaster so any subscribed pod whose
  // gitContext.repoPath matches gets a fresh stack (and via the .git watcher,
  // a fresh local snapshot).
  function nudgeAfterMutation(repoPath: string): void {
    if (!gitStatusBroadcaster) return
    gitStatusBroadcaster.triggerStackRefreshForRepo(repoPath)
  }

  return {
    checkInstall: orpc.handler(async (): Promise<InstallStatus> => {
      return probeInstall()
    }),

    checkRepo: orpc.input(z.object({ repoPath: z.string() })).handler(async ({ input }): Promise<RepoStatus> => {
      return probeRepo(input.repoPath)
    }),

    getStack: orpc
      .input(z.object({ repoPath: z.string() }))
      .handler(async ({ input }): Promise<GitStatusStack | null> => {
        // Workspace-level fetch — the user has clearly opted in by virtue of
        // calling this route from a Graphite-enabled workspace surface, so we
        // pass `enabled: true` and let computeStack report install/init state.
        let currentBranch: string | null = null
        try {
          const { stdout } = await execFileAsync('git', ['-C', input.repoPath, 'branch', '--show-current'], {
            timeout: 5_000,
            env: shellEnv(),
          })
          currentBranch = stdout.trim() || null
        } catch (err) {
          log.repo.debug('git branch --show-current failed', {
            repoPath: input.repoPath,
            error: err instanceof Error ? err.message : String(err),
          })
        }
        return computeStack({ enabled: true, repoPath: input.repoPath, currentBranch })
      }),

    // ---- Mutations ----

    /** `gt create [-m message] [name]` — stack a new branch on top of the current one. */
    create: orpc
      .input(
        z.object({
          repoPath: z.string(),
          name: z.string().optional(),
          message: z.string().optional(),
          all: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }): Promise<MutationResult> => {
        const args = ['create']
        if (input.message) args.push('-m', input.message)
        if (input.all) args.push('-a')
        if (input.name) args.push(input.name)
        const result = await runGtMutation(args, input.repoPath)
        if (result.success) nudgeAfterMutation(input.repoPath)
        return result
      }),

    /**
     * `gt modify` (amend tip) or `gt modify --commit -m message` (new commit on
     * current branch). Both restack children automatically.
     */
    modify: orpc
      .input(
        z.object({
          repoPath: z.string(),
          asNewCommit: z.boolean().optional(),
          message: z.string().optional(),
          all: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }): Promise<MutationResult> => {
        const args = ['modify']
        if (input.asNewCommit) args.push('--commit')
        const message = input.message || (!input.asNewCommit ? await getCurrentCommitMessage(input.repoPath) : null)
        if (message) args.push('-m', message)
        if (input.all) args.push('-a')
        const result = await runGtMutation(args, input.repoPath)
        if (result.success) nudgeAfterMutation(input.repoPath)
        return result
      }),

    /** `gt restack` — propagate parent updates down through children. */
    restack: orpc.input(z.object({ repoPath: z.string() })).handler(async ({ input }): Promise<MutationResult> => {
      const result = await runGtMutation(['restack'], input.repoPath)
      if (result.success) nudgeAfterMutation(input.repoPath)
      return result
    }),

    /** `gt sync` — pull trunk, restack stack, prune merged branches. */
    sync: orpc
      .input(
        z.object({
          repoPath: z.string(),
          force: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }): Promise<MutationResult> => {
        const args = ['sync']
        if (input.force) args.push('--force')
        const result = await runGtMutation(args, input.repoPath)
        if (result.success) nudgeAfterMutation(input.repoPath)
        return result
      }),

    /** `gt submit [--stack] [--draft]` — push branches and create / update PRs. */
    submit: orpc
      .input(
        z.object({
          repoPath: z.string(),
          stack: z.boolean().optional(),
          draft: z.boolean().optional(),
        }),
      )
      .handler(async ({ input }): Promise<MutationResult> => {
        const args = ['submit']
        args.push(input.stack ? '--stack' : '--no-stack', '--no-edit')
        if (input.draft) args.push('--draft')
        const result = await runGtMutation(args, input.repoPath)
        if (result.success) nudgeAfterMutation(input.repoPath)
        return result
      }),

    /** `gt branch checkout <name>` — switch to a branch in the stack. */
    checkoutBranch: orpc
      .input(z.object({ repoPath: z.string(), name: z.string() }))
      .handler(async ({ input }): Promise<MutationResult> => {
        const result = await runGtMutation(['branch', 'checkout', input.name], input.repoPath)
        if (result.success) nudgeAfterMutation(input.repoPath)
        return result
      }),
  }
}
