import { RiGitBranchLine, RiGitPullRequestLine, RiStackLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { useGitStatus } from '../hooks/use-git-status'
import { LineDelta } from './git-manager/line-delta'

interface GitDiffPillProps {
  podId: string
  active: boolean
  onClick: () => void
}

export function GitDiffPill({ podId, active, onClick }: GitDiffPillProps) {
  const { status } = useGitStatus(podId)
  if (!status || !status.local.isRepo) return null

  const stats = status.local.branchDiffStats ?? status.local.diffStats
  const pr = status.remote?.pr ?? null
  const hasConflicts = pr?.mergeable === 'CONFLICTING'
  const hasLineChanges = stats.additions > 0 || stats.deletions > 0
  const workingTreeFileCount =
    status.local.changedFileCount ??
    status.local.dirty.staged + status.local.dirty.unstaged + status.local.dirty.untracked
  const fallbackFileCount = status.local.branchDiffStats
    ? (status.local.branchDiffFileCount ?? workingTreeFileCount)
    : workingTreeFileCount
  const hasWorkingTreeChanges = status.local.hasWorkingTreeChanges ?? workingTreeFileCount > 0
  const hasFileChanges = fallbackFileCount > 0 || hasWorkingTreeChanges

  const stack = status.stack
  const branch = status.local.branch ?? null
  const stackBranch = stack?.branches.find((b) => b.name === branch) ?? null
  // Stack position is meaningful only when:
  // - Graphite is enabled and ready (gt installed + repo init'd)
  // - Current branch is part of the tracked stack
  // - The stack has at least one non-trunk branch (otherwise the count is misleading).
  const stackTotal = stack?.branches.length ?? 0
  const showStackPosition = stack?.enabled && stack.installed && stack.initialized && stackBranch && stackTotal > 1

  return (
    <Button
      variant="outline"
      size="xs"
      onClick={onClick}
      title={
        showStackPosition && stackBranch
          ? `${branch} · stack position ${stackBranch.position + 1}/${stackTotal}`
          : 'Git changes'
      }
      aria-label="Git changes"
      aria-pressed={active}
      className="relative"
    >
      <RiGitBranchLine className="size-3" />
      {branch && <span className="text-[10px] font-medium text-zinc-300 max-w-32 truncate">{branch}</span>}
      {showStackPosition && stackBranch && (
        <span className="flex items-center gap-0.5 text-[10px] font-medium text-violet-300">
          <RiStackLine className="size-3" />
          {stackBranch.position + 1}/{stackTotal}
        </span>
      )}
      {hasLineChanges ? (
        <LineDelta additions={stats.additions} deletions={stats.deletions} className="text-[10px]" />
      ) : hasFileChanges ? (
        <span
          className="font-mono tabular-nums text-[10px] text-amber-400"
          title={`${fallbackFileCount} changed file${fallbackFileCount === 1 ? '' : 's'}`}
        >
          {fallbackFileCount}
        </span>
      ) : null}
      {pr && (
        <span
          className={cn(
            'flex items-center gap-0.5 text-[10px] font-medium',
            pr.checks === 'success' ? 'text-emerald-400' : pr.checks === 'failure' ? 'text-red-400' : 'text-amber-400',
          )}
        >
          <RiGitPullRequestLine className="size-3" />#{pr.number}
        </span>
      )}
      {hasConflicts && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" />}
    </Button>
  )
}
