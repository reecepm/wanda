import { RiGitPullRequestLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import type { GitStatusPR } from '../../../../shared/contracts'
import { useGitStatus } from '../hooks/use-git-status'
import { LineDelta } from './git-manager/line-delta'

interface PodGitBadgeProps {
  podId: string
}

/**
 * Compact git indicator shown on the right side of a sidebar pod row, in the
 * slot the status dot previously occupied for local pods. Self-subscribes to
 * the unified git-status stream for this pod; renders nothing unless there's
 * actual data to show (diff counts or a PR).
 */
export function PodGitBadge({ podId }: PodGitBadgeProps) {
  const { status } = useGitStatus(podId)
  if (!status || !status.local.isRepo) return null

  // Prefer branch stats (vs merge-base) when on a feature branch; fall back
  // to uncommitted totals on default branch so the badge still shows dirty
  // work.
  const stats = status.local.branchDiffStats ?? status.local.diffStats
  const additions = stats.additions
  const deletions = stats.deletions
  const hasChanges = additions > 0 || deletions > 0
  const workingTreeFileCount =
    status.local.changedFileCount ??
    status.local.dirty.staged + status.local.dirty.unstaged + status.local.dirty.untracked
  const fallbackFileCount = status.local.branchDiffStats
    ? (status.local.branchDiffFileCount ?? workingTreeFileCount)
    : workingTreeFileCount
  const hasWorkingTreeChanges = status.local.hasWorkingTreeChanges ?? workingTreeFileCount > 0
  const hasFileChanges = fallbackFileCount > 0 || hasWorkingTreeChanges

  const pr = status.remote?.pr ?? null
  if (!hasChanges && !hasFileChanges && !pr) return null

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {hasChanges && <LineDelta additions={additions} deletions={deletions} />}
      {!hasChanges && hasFileChanges && (
        <span
          className="font-mono tabular-nums text-[10px] text-amber-400"
          title={`${fallbackFileCount} changed file${fallbackFileCount === 1 ? '' : 's'}`}
        >
          {fallbackFileCount}
        </span>
      )}
      {pr && <PRBadge pr={pr} />}
    </div>
  )
}

function PRBadge({ pr }: { pr: GitStatusPR }) {
  const color = resolvePRColor(pr)
  const conflicting = pr.mergeable === 'CONFLICTING'
  return (
    <span
      className={cn('relative inline-flex items-center gap-0.5 font-mono tabular-nums text-[10px]', color)}
      title={`PR #${pr.number}${pr.isDraft ? ' (draft)' : ''}${conflicting ? ' — conflicts' : ''}`}
    >
      <RiGitPullRequestLine className="size-3" />
      {pr.number}
      {conflicting && pr.state === 'OPEN' && (
        <span className="absolute -top-0.5 -right-1 h-1.5 w-1.5 rounded-full bg-red-500" />
      )}
    </span>
  )
}

function resolvePRColor(pr: GitStatusPR): string {
  if (pr.state === 'MERGED') return 'text-purple-400'
  if (pr.state === 'CLOSED') return 'text-zinc-500 line-through'
  if (pr.isDraft) return 'text-zinc-400'
  if (pr.checks === 'success') return 'text-emerald-400'
  if (pr.checks === 'failure') return 'text-red-400'
  return 'text-amber-400'
}
