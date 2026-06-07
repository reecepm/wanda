import { Effect } from 'effect'
import { z } from 'zod'
import { GitController, PodController } from '../../services'

import type { AppRouterDeps } from '../index'

const gitRefName = z
  .string()
  .regex(/^[\w.\-/@{}~^]+$/, 'Invalid git ref')
  .refine((ref) => !ref.includes('..') && !ref.startsWith('-'), 'Invalid git ref')

export function gitRoutes({ effectOs, orpc, resolveShellExec, gitWatcher, gitStatusBroadcaster }: AppRouterDeps) {
  return {
    /**
     * Start watching a .git directory for HEAD/index/refs changes. Change
     * events are broadcast via `orpc:invalidate` + `git:getStatus` (see
     * runtime.ts). Fire-and-forget.
     */
    watchRepo: orpc.input(z.object({ repoPath: z.string() })).handler(async ({ input }) => {
      gitWatcher?.watch(input.repoPath)
    }),

    /**
     * Unified git-status subscription. `subscribe` returns the current
     * snapshot and begins pushing `git:status` broadcast events whenever
     * the server detects a change. The client must call `unsubscribe` when
     * it stops rendering the pod so the server can stop the background
     * remote poller.
     */
    status: orpc.router({
      subscribe: orpc.input(z.object({ podId: z.string() })).handler(async ({ input }) => {
        if (!gitStatusBroadcaster) return null
        return (await gitStatusBroadcaster.subscribe(input.podId)) ?? null
      }),

      unsubscribe: orpc.input(z.object({ podId: z.string() })).handler(async ({ input }) => {
        await gitStatusBroadcaster?.unsubscribe(input.podId)
      }),

      /** Force both halves of the cache to refresh now. */
      refresh: orpc.input(z.object({ podId: z.string() })).handler(async ({ input }) => {
        await gitStatusBroadcaster?.refreshAll(input.podId)
      }),
    }),

    discover: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return null

      const shellExec = resolveShellExec(pod)
      if (!shellExec) return null

      return yield* gitSvc.discover(pod.cwd, shellExec)
    }),

    getStatus: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return null

      const gitCtx = pod.gitContext
      const repoPath = gitCtx?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return null

      return yield* gitSvc.getStatus(repoPath, shellExec)
    }),

    getDiff: effectOs
      .input(
        z.object({
          podId: z.string(),
          mode: z.enum(['uncommitted', 'branch']),
          baseRef: gitRefName.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const gitSvc = yield* GitController
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) return null

        const gitCtx = pod.gitContext
        const repoPath = gitCtx?.repoPath ?? pod.cwd
        const shellExec = resolveShellExec(pod)
        if (!shellExec) return null

        return yield* gitSvc.getDiff(
          repoPath,
          {
            mode: input.mode,
            baseRef: input.baseRef ?? gitCtx?.baseRef,
          },
          shellExec,
        )
      }),

    getFileContent: effectOs
      .input(z.object({ podId: z.string(), filePath: z.string(), ref: z.string().optional() }))
      .effect(function* ({ input }) {
        const gitSvc = yield* GitController
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) return null

        const gitCtx = pod.gitContext
        const repoPath = gitCtx?.repoPath ?? pod.cwd
        const shellExec = resolveShellExec(pod)
        if (!shellExec) return null

        return yield* gitSvc.getFileContent(repoPath, input.filePath, input.ref, shellExec)
      }),

    listBranches: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return []

      const gitCtx = pod.gitContext
      const repoPath = gitCtx?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return []

      return yield* gitSvc.listBranches(repoPath, shellExec)
    }),

    setContext: effectOs
      .input(
        z.object({
          podId: z.string(),
          gitContext: z
            .object({
              repoPath: z.string(),
              baseRef: gitRefName.optional(),
              source: z.enum(['auto', 'user']),
            })
            .nullable(),
        }),
      )
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.setGitContext(input.podId, input.gitContext)
        if (gitStatusBroadcaster) {
          yield* Effect.promise(() => gitStatusBroadcaster.refreshContext(input.podId))
        }
        return pod
      }),

    listRemoteBranches: effectOs.input(z.object({ repoUrl: z.string() })).effect(function* ({ input }) {
      const svc = yield* GitController
      return yield* svc.listRemoteBranches(input.repoUrl)
    }),

    stageFiles: effectOs.input(z.object({ podId: z.string(), files: z.array(z.string()) })).effect(function* ({
      input,
    }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return
      yield* gitSvc.stageFiles(repoPath, input.files, shellExec)
    }),

    unstageFiles: effectOs.input(z.object({ podId: z.string(), files: z.array(z.string()) })).effect(function* ({
      input,
    }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return
      yield* gitSvc.unstageFiles(repoPath, input.files, shellExec)
    }),

    stageAll: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return
      yield* gitSvc.stageAll(repoPath, shellExec)
    }),

    unstageAll: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return
      yield* gitSvc.unstageAll(repoPath, shellExec)
    }),

    commit: effectOs.input(z.object({ podId: z.string(), message: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { hash: '' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { hash: '' }
      return yield* gitSvc.commit(repoPath, input.message, shellExec)
    }),

    push: effectOs.input(z.object({ podId: z.string(), force: z.boolean().optional() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { success: false, error: 'Pod not found' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { success: false, error: 'No shell available' }
      const result = yield* gitSvc.push(repoPath, shellExec, { force: input.force })
      // A successful push can cascade GitHub state (new checks, PR updated).
      // Trigger a remote refresh so the PR badge + checks reflect soon.
      if (result.success) gitStatusBroadcaster?.triggerRemoteRefresh(input.podId)
      return result
    }),

    pull: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { success: false, error: 'Pod not found' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { success: false, error: 'No shell available' }
      return yield* gitSvc.pull(repoPath, shellExec)
    }),

    createBranch: effectOs.input(z.object({ podId: z.string(), branchName: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { success: false, error: 'Pod not found' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { success: false, error: 'No shell available' }
      return yield* gitSvc.createBranch(repoPath, input.branchName, shellExec)
    }),

    checkoutBranch: effectOs.input(z.object({ podId: z.string(), branchName: z.string() })).effect(function* ({
      input,
    }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { success: false, error: 'Pod not found' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { success: false, error: 'No shell available' }
      return yield* gitSvc.checkoutBranch(repoPath, input.branchName, shellExec)
    }),

    checkoutAndPull: effectOs.input(z.object({ podId: z.string(), branchName: z.string() })).effect(function* ({
      input,
    }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { success: false, stashed: false, error: 'Pod not found' }
      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { success: false, stashed: false, error: 'No shell available' }
      return yield* gitSvc.checkoutAndPull(repoPath, input.branchName, shellExec)
    }),

    /**
     * Toggle the "viewed" marker for a file. Computes the current content
     * hash via `git hash-object`. If a marker already exists and matches the
     * current hash, it's removed (unmarks viewed). Otherwise a new marker is
     * upserted with the current hash.
     */
    toggleFileViewed: effectOs.input(z.object({ podId: z.string(), filePath: z.string() })).effect(function* ({
      input,
    }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return { viewed: false }

      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return { viewed: false }

      return yield* gitSvc.toggleFileViewed(input.podId, input.filePath, repoPath, shellExec)
    }),

    /**
     * Returns the list of globs marking auto-generated files for the pod's
     * workspace. Combines (a) patterns from the repo's .gitattributes
     * (entries with `linguist-generated=true`), (b) the workspace's
     * configured `autoGeneratedGlobs`, or defaults if not configured.
     */
    getAutoGeneratedPatterns: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return [] as string[]

      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)

      return yield* gitSvc.getAutoGeneratedPatterns(repoPath, pod.workspaceId, shellExec)
    }),

    /**
     * Given a list of file paths, returns the subset that are currently
     * marked viewed AND whose stored content hash matches the current one.
     * Files whose hash has drifted are treated as unviewed automatically.
     */
    listViewedFiles: effectOs.input(z.object({ podId: z.string(), filePaths: z.array(z.string()) })).effect(function* ({
      input,
    }) {
      if (input.filePaths.length === 0) return [] as string[]

      const gitSvc = yield* GitController
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return [] as string[]

      const repoPath = pod.gitContext?.repoPath ?? pod.cwd
      const shellExec = resolveShellExec(pod)
      if (!shellExec) return [] as string[]

      return yield* gitSvc.listViewedFiles(input.podId, input.filePaths, repoPath, shellExec)
    }),
  }
}
