import { useLiveQuery } from '@tanstack/react-db'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { use } from 'react'
import { toast } from 'sonner'
import type { GitFileEntry } from '@/features/git/hooks/use-git-collection'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { DIFF_THEMES, type DiffTheme, useGitDiffStore } from '@/features/git/store/git-diff-store'
import type { DiffMode } from '@/features/git/utils/git-status'
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiEditLine,
  RiGitBranchLine,
  RiGitPullRequestLine,
  RiLayoutColumnLine,
  RiLayoutRowLine,
  RiLoader4Line,
  RiRefreshLine,
  RiStackLine,
  RiSubtractLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import type { GitStatusPR } from '../../../../../shared/contracts'
import { type GitContext, GitManagerContext } from './context'
import { LineDelta } from './line-delta'

interface HeaderProps {
  podId: string
  onClose: () => void
  diffMode: DiffMode
  setDiffMode: (mode: DiffMode) => void
  baseRef: string | undefined
  setBaseRef: (ref: string | undefined) => void
  showContextSelector: boolean
  setShowContextSelector: (show: boolean) => void
}

export function Header({
  podId,
  onClose,
  diffMode,
  setDiffMode,
  baseRef,
  setBaseRef,
  showContextSelector,
  setShowContextSelector,
}: HeaderProps) {
  const { collection } = use(GitManagerContext)!

  const { status: gitStatus, isLoading } = useGitStatus(podId)

  const { data: branches } = useQuery({
    ...orpcUtils.git.listBranches.queryOptions({ input: { podId } }),
    staleTime: 30000,
  })

  const { data: allFiles = [] } = useLiveQuery((q) => q.from({ f: collection }), [collection])
  const totalAdditions = (allFiles as GitFileEntry[]).reduce((s, f) => s + (f.additions ?? 0), 0)
  const totalDeletions = (allFiles as GitFileEntry[]).reduce((s, f) => s + (f.deletions ?? 0), 0)

  const noRepo = !isLoading && (!gitStatus || !gitStatus.local.isRepo)
  const branchName = gitStatus?.local.branch ?? null
  const pr = gitStatus?.remote?.pr ?? null
  const queryClient = useQueryClient()

  const stack = gitStatus?.stack ?? null
  const stackReady = !!(stack?.enabled && stack.installed && stack.initialized)
  const stackBranch = stack?.branches.find((b) => b.name === branchName) ?? null
  const stackParent = stackBranch?.parent ?? null
  const stackChildren = stackBranch?.children ?? []
  const isStackParentSelected = diffMode === 'branch' && !!stackParent && baseRef === stackParent

  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const repoPath = (pod?.gitContext as GitContext | null)?.repoPath ?? pod?.cwd ?? null

  const checkout = useMutation({
    mutationFn: async (name: string) => {
      const res = await orpcUtils.graphite.checkoutBranch.call({ repoPath: repoPath ?? '', name })
      if (!res.success) throw new Error(res.error ?? 'gt checkout failed')
      return res
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
      if (repoPath)
        queryClient.invalidateQueries({ queryKey: orpcUtils.graphite.getStack.key({ input: { repoPath } }) })
      collection.utils.refetch()
    },
  })

  function applyStackParentMode() {
    if (!stackParent) return
    setDiffMode('branch')
    setBaseRef(stackParent)
  }

  const diffStyle = useGitDiffStore((s) => s.diffStyle)
  const setDiffStyle = useGitDiffStore((s) => s.setDiffStyle)
  const fontSize = useGitDiffStore((s) => s.fontSize)
  const setFontSize = useGitDiffStore((s) => s.setFontSize)
  const theme = useGitDiffStore((s) => s.theme)
  const setTheme = useGitDiffStore((s) => s.setTheme)

  function refresh() {
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
    queryClient.invalidateQueries({
      queryKey: orpcUtils.git.getDiff.key({ input: { podId, mode: diffMode, baseRef } }),
    })
    collection.utils.refetch()
  }

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5">
          <RiGitBranchLine className="h-3.5 w-3.5 text-zinc-400" />
          {branchName ? (
            <span className="text-xs font-medium text-zinc-200">{branchName}</span>
          ) : noRepo ? (
            <span className="text-xs text-zinc-500 italic">No git repo</span>
          ) : (
            <span className="text-xs text-zinc-500">Loading...</span>
          )}
          <LineDelta additions={totalAdditions} deletions={totalDeletions} className="text-[10px] ml-1" />
        </div>

        {!noRepo && (
          <>
            <div className="h-3.5 w-px bg-zinc-700" />
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setDiffMode('uncommitted')}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                  diffMode === 'uncommitted' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                Uncommitted
              </button>
              <button
                type="button"
                onClick={() => setDiffMode('branch')}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                  diffMode === 'branch' && !isStackParentSelected
                    ? 'bg-zinc-700 text-zinc-200'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                Branch diff
              </button>
              {stackReady && stackParent && (
                <button
                  type="button"
                  onClick={applyStackParentMode}
                  title={`Diff this branch over its stack parent: ${stackParent}`}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                    isStackParentSelected ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  <RiStackLine className="size-3" />
                  Stack parent
                </button>
              )}
            </div>

            {stackReady && stackBranch && (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={!stackParent || checkout.isPending || !repoPath}
                  onClick={() =>
                    stackParent &&
                    checkout.mutate(stackParent, {
                      onSuccess: () => toast.success(`Checked out ${stackParent}`),
                      onError: (err) => toast.error(err.message),
                    })
                  }
                  title={stackParent ? `Move down to ${stackParent}` : 'Already at trunk'}
                >
                  {checkout.isPending ? <RiLoader4Line className="animate-spin" /> : <RiArrowLeftSLine />}
                </Button>
                <span className="text-[10px] text-zinc-500 tabular-nums px-0.5">
                  {stackBranch.position + 1}/{stack?.branches.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={stackChildren.length === 0 || checkout.isPending || !repoPath}
                  onClick={() => {
                    // Multiple children → pick the first; user can use the
                    // workspace stack tree to choose a specific path.
                    const next = stackChildren[0]
                    if (!next) return
                    checkout.mutate(next, {
                      onSuccess: () => toast.success(`Checked out ${next}`),
                      onError: (err) => toast.error(err.message),
                    })
                  }}
                  title={
                    stackChildren.length === 0
                      ? 'No upstack branches'
                      : `Move up to ${stackChildren[0]}${stackChildren.length > 1 ? ` (+${stackChildren.length - 1} sibling${stackChildren.length > 2 ? 's' : ''})` : ''}`
                  }
                >
                  <RiArrowRightSLine />
                </Button>
              </div>
            )}

            {diffMode === 'branch' && branches && branches.length > 0 && (
              <Select value={baseRef ?? ''} onValueChange={(v) => setBaseRef(v || undefined)}>
                <SelectTrigger size="sm" className="text-[11px]">
                  <SelectValue placeholder="Default base" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Default base</SelectItem>
                  {branches
                    .filter((b) => !b.current)
                    .map((b) => (
                      <SelectItem key={b.name} value={b.name}>
                        {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}

            <div className="h-3.5 w-px bg-zinc-700" />

            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setDiffStyle(diffStyle === 'unified' ? 'split' : 'unified')}
              title={diffStyle === 'unified' ? 'Side-by-side' : 'Unified'}
            >
              {diffStyle === 'unified' ? <RiLayoutColumnLine /> : <RiLayoutRowLine />}
            </Button>

            <div className="flex items-center gap-0.5">
              <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize - 1)} title="Smaller">
                <RiSubtractLine />
              </Button>
              <span className="text-[10px] text-zinc-500 w-5 text-center tabular-nums">{fontSize}</span>
              <Button variant="ghost" size="icon-xs" onClick={() => setFontSize(fontSize + 1)} title="Larger">
                <RiAddLine />
              </Button>
            </div>

            <Select value={theme} onValueChange={(v) => setTheme(v as DiffTheme)}>
              <SelectTrigger size="sm" className="text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DIFF_THEMES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {pr && (
              <>
                <div className="h-3.5 w-px bg-zinc-700" />
                <PRBadge pr={pr} />
              </>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-xs" onClick={refresh} title="Refresh">
          <RiRefreshLine className={cn(isLoading && 'animate-spin')} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowContextSelector(!showContextSelector)}
          title="Git settings"
        >
          <RiEditLine />
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close (Esc)">
          <RiCloseLine />
        </Button>
      </div>
    </div>
  )
}

function PRBadge({ pr }: { pr: GitStatusPR }) {
  const hasConflicts = pr.mergeable === 'CONFLICTING'
  const isMerged = pr.state === 'MERGED'
  const isClosed = pr.state === 'CLOSED'
  const canMerge = pr.state === 'OPEN' && !hasConflicts && pr.checks === 'success'

  let statusColor = 'text-zinc-400 bg-zinc-800'
  let statusLabel = ''

  if (isMerged) {
    statusColor = 'text-purple-300 bg-purple-950/50'
    statusLabel = 'Merged'
  } else if (isClosed) {
    statusColor = 'text-red-300 bg-red-950/50'
    statusLabel = 'Closed'
  } else if (hasConflicts) {
    statusColor = 'text-red-300 bg-red-950/50'
    statusLabel = 'Conflicts'
  } else if (pr.checks === 'failure') {
    statusColor = 'text-red-300 bg-red-950/50'
    statusLabel = 'Checks failing'
  } else if (pr.checks === 'pending') {
    statusColor = 'text-amber-300 bg-amber-950/50'
    statusLabel = 'Checks running'
  } else if (canMerge) {
    statusColor = 'text-emerald-300 bg-emerald-950/50'
    statusLabel = 'Ready to merge'
  }

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium hover:opacity-80 transition-opacity',
        statusColor,
      )}
    >
      <RiGitPullRequestLine className="h-3 w-3" />
      <span>#{pr.number}</span>
      {statusLabel && (
        <>
          <span className="text-zinc-600">·</span>
          <span>{statusLabel}</span>
        </>
      )}
    </a>
  )
}
