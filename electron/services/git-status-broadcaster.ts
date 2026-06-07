import { Effect } from 'effect'
import type {
  GitStatus,
  GitStatusEvent,
  GitStatusLocal,
  GitStatusRemote,
  GitStatusStack,
} from '../../shared/contracts/git-status'
import type { pods } from '../db/schema'
import type { AppManagedRuntime } from '../domains'
import { condensePRStatus, GitController, ghGetPRStatus, type ShellExecFn } from '../domains/git/controller'
import { PodController } from '../domains/pod'
import { log } from '../packages/logger'
import { WorkspaceSettingsController } from '../services'
import type { GitWatcher } from './git-watcher'
import { computeStack } from './graphite-stack'

// -----------------------------------------------------------------------------
// GitStatusBroadcaster — unified git state for every UI surface.
//
// Maintains one canonical `GitStatus` per pod on the server and pushes
// granular update events (`snapshot | localUpdated | remoteUpdated`) over
// the `git:status` WebSocket channel. Clients subscribe per-pod; the
// broadcaster reference-counts subscribers so the remote poller only runs
// while at least one client is watching.
//
// Local refreshes are driven by the `.git` file watcher (already debounced
// to ~300ms). Remote refreshes run on a 30s interval while subscribed, and
// can be triggered explicitly after mutations that affect the upstream or
// the PR (push, merge, etc.).
//
// Fingerprint gating: only publishes when the JSON-serialised half (local
// or remote) actually differs from what's cached — prevents redundant
// renders when git status runs but nothing changed.
// -----------------------------------------------------------------------------

type PodRow = typeof pods.$inferSelect

const REMOTE_POLL_INTERVAL_MS = 30_000
const LOCAL_POLL_INTERVAL_MS = 2_000
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'development'])
/** Workspace-graphite-enabled cache TTL — settings change is rare. */
const WORKSPACE_GRAPHITE_TTL_MS = 30_000

export type BroadcastGitStatusFn = (event: GitStatusEvent) => void

type PodEntry = {
  readonly podId: string
  readonly workspaceId: string | null
  readonly repoPath: string
  readonly baseRef: string | undefined
  readonly shellExec: ShellExecFn
  subscribers: number
  cache: GitStatus | null
  localTimer: ReturnType<typeof setInterval> | null
  remoteTimer: ReturnType<typeof setInterval> | null
  /** Serialized in-flight local refresh, so overlapping triggers don't pile up. */
  localRefresh: Promise<void> | null
  remoteRefresh: Promise<void> | null
  stackRefresh: Promise<void> | null
  /** Branch as of the last stack refresh — used to detect when we should re-walk. */
  stackBranchAtLastRefresh: string | null
}

export class GitStatusBroadcaster {
  private readonly entries = new Map<string, PodEntry>()
  private readonly repoPathIndex = new Map<string, Set<string>>()
  private readonly runtime: AppManagedRuntime
  private readonly resolveShellExec: (pod: { cwd: string }) => ShellExecFn | null
  private readonly broadcast: BroadcastGitStatusFn
  private readonly gitWatcher: GitWatcher
  /** workspaceId → { enabled, expiresAt }. Avoids hammering the DB on every poll tick. */
  private readonly workspaceGraphiteCache = new Map<string, { enabled: boolean; expiresAt: number }>()

  constructor(
    runtime: AppManagedRuntime,
    resolveShellExec: (pod: { cwd: string }) => ShellExecFn | null,
    broadcast: BroadcastGitStatusFn,
    gitWatcher: GitWatcher,
  ) {
    this.runtime = runtime
    this.resolveShellExec = resolveShellExec
    this.broadcast = broadcast
    this.gitWatcher = gitWatcher
  }

  // -------------------------------------------------------------------------
  // Subscription lifecycle
  // -------------------------------------------------------------------------

  async subscribe(podId: string): Promise<GitStatus | null> {
    let entry = this.entries.get(podId)

    if (!entry) {
      const prepared = await this.prepareEntry(podId)
      if (!prepared) return null
      entry = prepared
      this.entries.set(podId, entry)

      // Register repo with the watcher and our reverse map.
      this.gitWatcher.watch(entry.repoPath)
      const set = this.repoPathIndex.get(entry.repoPath) ?? new Set<string>()
      set.add(podId)
      this.repoPathIndex.set(entry.repoPath, set)
    }

    entry.subscribers++

    // First-time subscription: compute local immediately, kick off remote.
    if (!entry.cache) {
      await this.refreshLocal(podId)
    } else {
      // Re-subscribing client with a warm cache — replay the snapshot just for them.
      // We broadcast rather than returning-only because cache reads are cheap and
      // this keeps the client's event stream contract uniform (one snapshot per
      // subscribe, regardless of warm/cold).
      this.broadcast({ kind: 'snapshot', status: entry.cache })
    }

    if (!entry.remoteTimer) {
      entry.remoteTimer = setInterval(() => {
        void this.refreshRemote(podId).catch((err) =>
          log.main.warn(`git-status remote refresh failed for ${podId}:`, err),
        )
      }, REMOTE_POLL_INTERVAL_MS)
      // Kick off initial remote fetch out-of-band so local paints immediately.
      void this.refreshRemote(podId).catch((err) =>
        log.main.warn(`git-status initial remote refresh failed for ${podId}:`, err),
      )
    }

    // Per-pod local polling — same pattern as the remote timer above. Runs
    // while the pod has ≥1 subscriber. `refreshLocal` dedupes in-flight
    // calls and the broadcaster skips no-op updates via fingerprint gating,
    // so this is cheap at steady state.
    if (!entry.localTimer) {
      log.main.info(`git-status: starting local poll for ${podId} (interval=${LOCAL_POLL_INTERVAL_MS}ms)`)
      entry.localTimer = setInterval(() => {
        void this.refreshLocal(podId).catch((err) => log.main.warn(`git-status local poll failed for ${podId}:`, err))
      }, LOCAL_POLL_INTERVAL_MS)
    }

    return entry.cache
  }

  async unsubscribe(podId: string): Promise<void> {
    const entry = this.entries.get(podId)
    if (!entry) return
    entry.subscribers = Math.max(0, entry.subscribers - 1)
    if (entry.subscribers > 0) return

    if (entry.remoteTimer) {
      clearInterval(entry.remoteTimer)
      entry.remoteTimer = null
    }
    if (entry.localTimer) {
      clearInterval(entry.localTimer)
      entry.localTimer = null
    }

    const set = this.repoPathIndex.get(entry.repoPath)
    if (set) {
      set.delete(podId)
      if (set.size === 0) {
        this.repoPathIndex.delete(entry.repoPath)
        this.gitWatcher.unwatch(entry.repoPath)
      }
    }
    this.entries.delete(podId)
  }

  /** Drop every subscription (used when a WS client disconnects). */
  async releaseAll(podIds: Iterable<string>): Promise<void> {
    for (const podId of podIds) {
      await this.unsubscribe(podId)
    }
  }

  // -------------------------------------------------------------------------
  // Trigger points
  // -------------------------------------------------------------------------

  /**
   * Nudge for a changed path. Fires an immediate `refreshLocal` for every
   * subscribed pod whose repoPath matches — exact match (fast path for the
   * `.git/` watcher, which hands us the canonical repo root) OR ancestor
   * match for agent hooks, which pass the pod's `cwd` (which may be the
   * repo root or a subdir of it).
   */
  onRepoChanged(path: string): void {
    const seen = new Set<string>()
    const exact = this.repoPathIndex.get(path)
    if (exact) for (const id of exact) seen.add(id)

    // Ancestor / descendant match — handles agent cwd that may be a subdir
    // of the repo root, or a repo root that's a subdir of the reported cwd.
    for (const [repoPath, podIds] of this.repoPathIndex) {
      if (repoPath === path) continue
      if (path.startsWith(`${repoPath}/`) || repoPath.startsWith(`${path}/`)) {
        for (const id of podIds) seen.add(id)
      }
    }

    for (const podId of seen) {
      void this.refreshLocal(podId).catch((err) => log.main.warn(`git-status local refresh failed for ${podId}:`, err))
    }
  }

  /** Called after mutations that can only affect the remote (e.g. `gh pr merge`). */
  triggerRemoteRefresh(podId: string): void {
    if (!this.entries.has(podId)) return
    void this.refreshRemote(podId).catch((err) => log.main.warn(`git-status remote refresh failed for ${podId}:`, err))
  }

  /** Same as `triggerRemoteRefresh` but fans out to every pod currently subscribed for a repo path. */
  triggerRemoteRefreshForRepo(repoPath: string): void {
    const podIds = this.repoPathIndex.get(repoPath)
    if (!podIds || podIds.size === 0) return
    for (const podId of podIds) {
      this.triggerRemoteRefresh(podId)
    }
  }

  /** Force a full refresh of both halves. */
  async refreshAll(podId: string): Promise<void> {
    await Promise.allSettled([this.refreshLocal(podId), this.refreshRemote(podId)])
  }

  /**
   * Re-read the pod's gitContext from the DB and rebuild the cached entry's
   * repoPath/baseRef/shellExec, preserving subscriber count and timers.
   * Call this whenever a pod's gitContext changes — otherwise the broadcaster
   * keeps using whatever it captured at first subscribe time, which is wrong
   * after `setContext` or after async git discovery completes.
   */
  async refreshContext(podId: string): Promise<void> {
    const entry = this.entries.get(podId)
    if (!entry) return
    const pod = await this.lookupPod(podId)
    if (!pod) return
    const shellExec = this.resolveShellExec(pod)
    if (!shellExec) return
    const gitCtx = pod.gitContext
    const repoPath = gitCtx?.repoPath ?? pod.cwd
    const newBaseRef = gitCtx?.baseRef

    if (entry.repoPath === repoPath && entry.baseRef === newBaseRef) return

    if (entry.repoPath !== repoPath) {
      const oldSet = this.repoPathIndex.get(entry.repoPath)
      if (oldSet) {
        oldSet.delete(podId)
        if (oldSet.size === 0) {
          this.repoPathIndex.delete(entry.repoPath)
          this.gitWatcher.unwatch(entry.repoPath)
        }
      }
      this.gitWatcher.watch(repoPath)
      const newSet = this.repoPathIndex.get(repoPath) ?? new Set<string>()
      newSet.add(podId)
      this.repoPathIndex.set(repoPath, newSet)
    }

    const next: PodEntry = { ...entry, repoPath, baseRef: newBaseRef, shellExec }
    this.entries.set(podId, next)
    await this.refreshLocal(podId)
    // Branch may have changed under us; force a stack rebuild on next tick.
    next.stackBranchAtLastRefresh = null
    void this.refreshStack(podId).catch((err) => log.main.warn(`git-status stack refresh failed for ${podId}:`, err))
  }

  // -------------------------------------------------------------------------
  // Refresh internals
  // -------------------------------------------------------------------------

  private refreshLocal(podId: string): Promise<void> {
    const entry = this.entries.get(podId)
    if (!entry) return Promise.resolve()
    if (entry.localRefresh) return entry.localRefresh

    const p = this.doRefreshLocal(entry).finally(() => {
      entry.localRefresh = null
    })
    entry.localRefresh = p
    return p
  }

  private async doRefreshLocal(entry: PodEntry): Promise<void> {
    const local = await this.computeLocal(entry)
    if (!local) return

    const prev = entry.cache
    const localChanged = !prev || fingerprintLocal(prev.local) !== fingerprintLocal(local)

    if (localChanged) {
      if (!prev) {
        const next: GitStatus = { podId: entry.podId, local, remote: null, stack: null }
        entry.cache = next
        this.broadcast({ kind: 'snapshot', status: next })
      } else {
        entry.cache = { ...prev, local }
        this.broadcast({ kind: 'localUpdated', podId: entry.podId, local })
      }
    }

    // Trigger a stack refresh whenever local published. Cheap if not enabled
    // (workspace lookup hits an in-memory cache) and `refreshStack` dedupes.
    if (localChanged || !prev?.stack) {
      void this.refreshStack(entry.podId).catch((err) =>
        log.main.warn(`git-status stack refresh failed for ${entry.podId}:`, err),
      )
    }
  }

  private refreshRemote(podId: string): Promise<void> {
    const entry = this.entries.get(podId)
    if (!entry) return Promise.resolve()
    if (entry.remoteRefresh) return entry.remoteRefresh

    const p = this.doRefreshRemote(entry).finally(() => {
      entry.remoteRefresh = null
    })
    entry.remoteRefresh = p
    return p
  }

  private async doRefreshRemote(entry: PodEntry): Promise<void> {
    const prev = entry.cache
    // Remote only makes sense once local has told us we're in a repo on a
    // non-default branch with an upstream. Skip the `gh` call otherwise.
    if (!prev || !prev.local.isRepo) return
    if (prev.local.isDefaultBranch || !prev.local.upstream) {
      // Represent "no PR expected" as a resolved remote with pr=null, so
      // clients can render past the skeleton.
      const empty: GitStatusRemote = { pr: null, updatedAt: Date.now() }
      if (prev.remote && fingerprintRemote(prev.remote) === fingerprintRemote(empty)) return
      entry.cache = { ...prev, remote: empty }
      this.broadcast({ kind: 'remoteUpdated', podId: entry.podId, remote: empty })
      return
    }

    const raw = await ghGetPRStatus(entry.repoPath)
    const pr = condensePRStatus(raw)
    const remote: GitStatusRemote = { pr, updatedAt: Date.now() }

    if (prev.remote && fingerprintRemote(prev.remote) === fingerprintRemote(remote)) return
    entry.cache = { ...prev, remote }
    this.broadcast({ kind: 'remoteUpdated', podId: entry.podId, remote })
  }

  // -------------------------------------------------------------------------
  // Computation
  // -------------------------------------------------------------------------

  private async prepareEntry(podId: string): Promise<PodEntry | null> {
    const pod = await this.lookupPod(podId)
    if (!pod) return null
    const shellExec = this.resolveShellExec(pod)
    if (!shellExec) return null
    const gitCtx = pod.gitContext
    const repoPath = gitCtx?.repoPath ?? pod.cwd
    return {
      podId,
      workspaceId: pod.workspaceId ?? null,
      repoPath,
      baseRef: gitCtx?.baseRef,
      shellExec,
      subscribers: 0,
      cache: null,
      localTimer: null,
      remoteTimer: null,
      localRefresh: null,
      remoteRefresh: null,
      stackRefresh: null,
      stackBranchAtLastRefresh: null,
    }
  }

  private async lookupPod(podId: string): Promise<PodRow | null> {
    try {
      const pod = await this.runtime.runPromise(
        Effect.gen(function* () {
          const podSvc = yield* PodController
          return yield* podSvc.getById(podId)
        }),
      )
      return pod ?? null
    } catch (err) {
      log.main.warn(`git-status: failed to resolve pod ${podId}:`, err)
      return null
    }
  }

  private async isGraphiteEnabledForWorkspace(workspaceId: string | null): Promise<boolean> {
    if (!workspaceId) return false
    const now = Date.now()
    const cached = this.workspaceGraphiteCache.get(workspaceId)
    if (cached && cached.expiresAt > now) return cached.enabled
    let enabled = false
    try {
      const settings = await this.runtime.runPromise(
        Effect.gen(function* () {
          const svc = yield* WorkspaceSettingsController
          return yield* svc.getByWorkspace(workspaceId)
        }),
      )
      enabled = !!settings?.graphiteEnabled
    } catch (err) {
      log.main.warn(`git-status: failed to load workspace settings ${workspaceId}:`, err)
    }
    this.workspaceGraphiteCache.set(workspaceId, { enabled, expiresAt: now + WORKSPACE_GRAPHITE_TTL_MS })
    return enabled
  }

  private refreshStack(podId: string): Promise<void> {
    const entry = this.entries.get(podId)
    if (!entry) return Promise.resolve()
    if (entry.stackRefresh) return entry.stackRefresh

    const p = this.doRefreshStack(entry).finally(() => {
      entry.stackRefresh = null
    })
    entry.stackRefresh = p
    return p
  }

  private async doRefreshStack(entry: PodEntry): Promise<void> {
    const enabled = await this.isGraphiteEnabledForWorkspace(entry.workspaceId)
    const prev = entry.cache
    const currentBranch = prev?.local.branch ?? null

    // Skip the (modestly expensive) tree walk when we're confident nothing
    // moved: branch is unchanged AND we already have a stack snapshot whose
    // `enabled` matches today's setting.
    if (enabled && prev?.stack && prev.stack.enabled === enabled && entry.stackBranchAtLastRefresh === currentBranch) {
      // Still update isCurrent flags if nothing else changed but trivially
      // skip — branch hasn't moved, no point.
      return
    }

    const stack = await computeStack({
      enabled,
      repoPath: entry.repoPath,
      currentBranch,
    })
    entry.stackBranchAtLastRefresh = currentBranch

    const prevStack = prev?.stack ?? null
    if (fingerprintStack(prevStack) === fingerprintStack(stack)) return

    if (!prev) return // local hasn't seeded the cache yet — next local tick will pull stack along.

    entry.cache = { ...prev, stack }
    this.broadcast({ kind: 'stackUpdated', podId: entry.podId, stack })
  }

  /** Public hook for mutation routes — invalidate workspace cache + force a stack refresh on every pod in that workspace. */
  invalidateWorkspaceGraphite(workspaceId: string): void {
    this.workspaceGraphiteCache.delete(workspaceId)
    for (const entry of this.entries.values()) {
      if (entry.workspaceId !== workspaceId) continue
      entry.stackBranchAtLastRefresh = null
      void this.refreshStack(entry.podId).catch((err) =>
        log.main.warn(`git-status stack refresh failed for ${entry.podId}:`, err),
      )
    }
  }

  /** Force stack refresh for every pod whose repoPath matches. Used after gt mutations. */
  triggerStackRefreshForRepo(repoPath: string): void {
    const podIds = this.repoPathIndex.get(repoPath)
    if (!podIds || podIds.size === 0) return
    for (const podId of podIds) {
      const entry = this.entries.get(podId)
      if (!entry) continue
      entry.stackBranchAtLastRefresh = null
      void this.refreshStack(podId).catch((err) => log.main.warn(`git-status stack refresh failed for ${podId}:`, err))
      // Also kick local — gt mutations move the branch tip and rewrite refs.
      void this.refreshLocal(podId).catch((err) => log.main.warn(`git-status local refresh failed for ${podId}:`, err))
    }
  }

  private async computeLocal(entry: PodEntry): Promise<GitStatusLocal | null> {
    try {
      const local = await this.runtime.runPromise(
        Effect.gen(function* () {
          const gitSvc = yield* GitController
          const snap = yield* gitSvc.getLocalSnapshot(entry.repoPath, entry.baseRef, entry.shellExec)
          const isRepo = snap.isRepo
          const isDefaultBranch = DEFAULT_BRANCHES.has(snap.branch ?? '')
          const diffStats = sumDiffStats(snap.uncommittedFiles)
          // Only compute branch diff when the pod knows its own merge-base
          // (worktree pods record `branchFrom`, or the user set one explicitly).
          // Without that, falling back to "main" produces a misleading diff
          // for any feature branch — especially on fresh pods.
          const branchDiffStats = isDefaultBranch || !entry.baseRef ? null : sumDiffStats(snap.branchFiles)
          const branchDiffFileCount = branchDiffStats ? snap.branchFiles.length : null

          const snapshot: GitStatusLocal = {
            isRepo,
            branch: snap.branch,
            upstream: snap.upstream,
            hasRemote: snap.hasRemote,
            isDefaultBranch,
            ahead: snap.ahead,
            behind: snap.behind,
            dirty: {
              staged: snap.staged.length,
              unstaged: snap.unstaged.length,
              untracked: snap.untracked.length,
            },
            hasWorkingTreeChanges: snap.hasWorkingTreeChanges,
            changedFileCount: snap.changedFileCount,
            diffStats,
            branchDiffStats,
            branchDiffFileCount,
            updatedAt: Date.now(),
          }
          return snapshot
        }),
      )
      return local
    } catch (err) {
      log.main.warn(`git-status: failed to compute local for ${entry.podId}:`, err)
      return null
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sumDiffStats(files: ReadonlyArray<{ additions: number; deletions: number }>) {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { additions, deletions }
}

function fingerprintLocal(local: GitStatusLocal): string {
  // Exclude `updatedAt` from the fingerprint — it always ticks.
  const { updatedAt: _, ...rest } = local
  return JSON.stringify(rest)
}

function fingerprintRemote(remote: GitStatusRemote): string {
  const { updatedAt: _, ...rest } = remote
  return JSON.stringify(rest)
}

function fingerprintStack(stack: GitStatusStack | null): string {
  if (!stack) return 'null'
  const { updatedAt: _, ...rest } = stack
  return JSON.stringify(rest)
}
