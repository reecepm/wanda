// -----------------------------------------------------------------------------
// Unified git status contract.
//
// Every UI surface that shows git-derived data (sidebar badges, topbar diff
// pill, git manager header, tray menu, tray icon badge) reads from this one
// shape. The server maintains a canonical cache per pod and pushes
// `GitStatusEvent`s over the `git:status` channel — clients do not poll.
//
// The state is split into `local` (filesystem-derived, fast) and `remote`
// (upstream + GitHub-derived, slow), letting surfaces render the fast half
// immediately while the slow half arrives via a separate event.
//
// Heavy per-file data (full file lists, raw diff text) is intentionally NOT
// in this contract — it stays behind the existing on-demand oRPC queries
// because only the git manager view needs it.
// -----------------------------------------------------------------------------

/** Condensed CI status derived from the GitHub statusCheckRollup. */
export type ChecksStatus = 'success' | 'failure' | 'pending' | 'none'

export type PRState = 'OPEN' | 'CLOSED' | 'MERGED'
export type PRMergeable = 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN'

export interface GitStatusLocal {
  readonly isRepo: boolean
  readonly branch: string | null
  readonly upstream: string | null
  /** True when the repo has at least one git remote configured. */
  readonly hasRemote: boolean
  readonly isDefaultBranch: boolean
  /** Commits ahead of upstream. 0 when there is no upstream. */
  readonly ahead: number
  /** Commits behind upstream. 0 when there is no upstream. */
  readonly behind: number
  readonly dirty: {
    readonly staged: number
    readonly unstaged: number
    readonly untracked: number
  }
  /** True when porcelain status reports any staged, unstaged, untracked, or conflicted working-tree change. */
  readonly hasWorkingTreeChanges: boolean
  /** Unique changed file count for lightweight indicators. Does not include full per-file metadata. */
  readonly changedFileCount: number
  /** Line additions/deletions for uncommitted changes (working tree + index). */
  readonly diffStats: { readonly additions: number; readonly deletions: number }
  /** Line additions/deletions vs merge-base with the default branch. Null on default branch or when no base is known. */
  readonly branchDiffStats: { readonly additions: number; readonly deletions: number } | null
  /** Unique file count vs merge-base with the default branch. Null when branchDiffStats is null. */
  readonly branchDiffFileCount: number | null
  /** Wall-clock ms when this local snapshot was computed on the server. */
  readonly updatedAt: number
}

export interface GitStatusPR {
  readonly number: number
  readonly state: PRState
  readonly isDraft: boolean
  readonly mergeable: PRMergeable
  readonly checks: ChecksStatus
  readonly url: string
  readonly title: string
  readonly headRefName: string
  readonly baseRefName: string
}

export interface GitStatusRemote {
  readonly pr: GitStatusPR | null
  /** Wall-clock ms when this remote snapshot was computed on the server. */
  readonly updatedAt: number
}

/**
 * Per-branch entry in a Graphite stack. `position` is 0 for trunk and
 * increments along the path from trunk → tip. `parent` is null only for
 * trunk. The flat array preserves the tree shape via the parent pointer.
 */
export interface GitStatusStackBranch {
  readonly name: string
  readonly parent: string | null
  readonly position: number
  readonly children: ReadonlyArray<string>
  readonly isCurrent: boolean
}

/**
 * Graphite stack snapshot. `null` when the workspace has not opted in.
 * When opted in, this object always reports current install/init state so
 * UI can show actionable status without an extra round-trip.
 */
export interface GitStatusStack {
  readonly enabled: boolean
  readonly installed: boolean
  readonly initialized: boolean
  readonly trunk: string | null
  readonly current: string | null
  readonly branches: ReadonlyArray<GitStatusStackBranch>
  readonly updatedAt: number
}

export interface GitStatus {
  readonly podId: string
  readonly local: GitStatusLocal
  /** Null until the first remote poll completes. Surfaces should render local immediately and show a skeleton for PR/CI. */
  readonly remote: GitStatusRemote | null
  /** Null when the workspace has not enabled Graphite. */
  readonly stack: GitStatusStack | null
}

/**
 * Wire events pushed on the `git:status` channel.
 *
 * - `snapshot`     — full state, sent when a client first subscribes.
 * - `localUpdated` — local half changed (fs watcher or mutation triggered).
 * - `remoteUpdated`— remote half changed (background poller or push-triggered).
 *
 * Clients apply events by writing into the TanStack Query cache keyed by podId.
 */
export type GitStatusEvent =
  | { readonly kind: 'snapshot'; readonly status: GitStatus }
  | { readonly kind: 'localUpdated'; readonly podId: string; readonly local: GitStatusLocal }
  | { readonly kind: 'remoteUpdated'; readonly podId: string; readonly remote: GitStatusRemote | null }
  | { readonly kind: 'stackUpdated'; readonly podId: string; readonly stack: GitStatusStack | null }
