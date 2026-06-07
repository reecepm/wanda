import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  RiArrowDownSLine,
  RiExternalLinkLine,
  RiGitCommitLine,
  RiGitForkLine,
  RiGitMergeLine,
  RiGitPullRequestLine,
  RiLoader4Line,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import type { GitContext, PRStatus } from './context'
import type { MergedWorktreePrompt } from './pr-section'

type ChecksState = 'success' | 'failure' | 'pending'

export function PRStatusView({
  podId,
  prStatus,
  gitContext,
  onMergedWorktreePrompt,
}: {
  podId: string
  prStatus: PRStatus
  gitContext: GitContext | null
  onMergedWorktreePrompt: (prompt: MergedWorktreePrompt) => void
}) {
  const queryClient = useQueryClient()

  const mergePRMutation = useMutation({
    mutationFn: (method: MergeMethod) => orpcUtils.app.mergePR.call({ repoPath: gitContext!.repoPath, method }),
    onSettled: () => {
      if (gitContext?.repoPath)
        queryClient.invalidateQueries({
          queryKey: orpcUtils.app.getPRStatus.key({ input: { repoPath: gitContext.repoPath } }),
        })
    },
  })

  const hasConflicts = prStatus.mergeable === 'CONFLICTING'
  const checksState = rollupChecksState(prStatus.statusCheckRollup)

  function handleMerge(method: MergeMethod) {
    mergePRMutation.mutate(method, {
      onSuccess: async (result) => {
        if (result?.merged) {
          toast.success('PR merged')

          if (gitContext?.worktreePath) {
            // Worktree: prompt the user — auto-checkout would collide with main being checked out elsewhere.
            onMergedWorktreePrompt({
              repoPath: gitContext.repoPath,
              worktreePath: gitContext.worktreePath,
              baseRefName: prStatus.baseRefName,
            })
          } else {
            // Non-worktree: checkout base branch, pull merged changes, stash if dirty
            try {
              const r = await orpcUtils.git.checkoutAndPull.call({ podId, branchName: prStatus.baseRefName })
              if (r.success) {
                if (r.stashed) {
                  toast.success(
                    `Switched to ${prStatus.baseRefName} and pulled. Uncommitted changes were stashed and restored.`,
                  )
                } else {
                  toast.success(`Switched to ${prStatus.baseRefName} and pulled`)
                }
                if (r.error) toast.warning(r.error)
              } else {
                toast.error(r.error ?? 'Failed to checkout')
              }
              queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
            } catch (err) {
              toast.error(
                `Failed to switch to ${prStatus.baseRefName}: ${err instanceof Error ? err.message : 'unknown error'}`,
              )
            }
          }
        }
      },
      onError: (err) => toast.error(`Merge failed: ${err.message}`),
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <PRStatusHeader title={prStatus.title} url={prStatus.url} />
      {checksState && <ChecksBanner state={checksState} />}
      {hasConflicts && <ConflictBanner prStatus={prStatus} />}
      {!hasConflicts && <MergeSplitButton isPending={mergePRMutation.isPending} onMerge={handleMerge} />}
    </div>
  )
}

function rollupChecksState(rollup: { state: string }[] | undefined): ChecksState | null {
  if (!rollup?.length) return null
  if (rollup.every((c) => c.state === 'SUCCESS')) return 'success'
  if (rollup.some((c) => c.state === 'FAILURE' || c.state === 'ERROR')) return 'failure'
  return 'pending'
}

function PRStatusHeader({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 min-w-0">
        <RiGitPullRequestLine className="h-3 w-3 text-emerald-400 shrink-0" />
        <span className="text-[11px] font-medium text-zinc-200 truncate">{title}</span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
      >
        <RiExternalLinkLine className="h-3 w-3" />
      </a>
    </div>
  )
}

function ChecksBanner({ state }: { state: ChecksState }) {
  return (
    <div
      className={cn(
        'text-[10px] px-2 py-1 rounded-md',
        state === 'success'
          ? 'bg-emerald-950/50 text-emerald-400'
          : state === 'failure'
            ? 'bg-red-950/50 text-red-400'
            : 'bg-amber-950/50 text-amber-400',
      )}
    >
      Checks: {state}
    </div>
  )
}

function ConflictBanner({ prStatus }: { prStatus: PRStatus }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] px-2 py-1 rounded-md bg-red-950/50 text-red-400">Merge conflicts</div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(buildConflictPrompt(prStatus))
          toast.success('Resolution prompt copied')
        }}
        className="text-[10px] text-red-400 hover:text-red-300 underline text-left"
      >
        Copy resolution prompt
      </button>
    </div>
  )
}

function buildConflictPrompt(prStatus: PRStatus): string {
  const fileList = prStatus.files?.length
    ? prStatus.files.map((f) => `  - ${f.path} (+${f.additions}/-${f.deletions})`).join('\n')
    : '  (file list unavailable)'
  return [
    `PR #${prStatus.number}: "${prStatus.title}"`,
    `Branch: ${prStatus.headRefName} → ${prStatus.baseRefName}`,
    `URL: ${prStatus.url}`,
    '',
    'This PR has merge conflicts that need to be resolved.',
    '',
    'Files changed in this PR:',
    fileList,
    '',
    'Steps to resolve:',
    `1. git fetch origin`,
    `2. git checkout ${prStatus.headRefName}`,
    `3. git merge origin/${prStatus.baseRefName}`,
    '4. Resolve the conflicts in the affected files',
    '5. git add the resolved files',
    '6. git commit',
    `7. git push origin ${prStatus.headRefName}`,
  ].join('\n')
}

const MERGE_METHODS = {
  squash: {
    label: 'Squash and merge',
    description: 'Combine all commits into one before merging',
    icon: RiGitCommitLine,
  },
  merge: {
    label: 'Create a merge commit',
    description: 'Preserve all commits and add a merge commit',
    icon: RiGitMergeLine,
  },
  rebase: {
    label: 'Rebase and merge',
    description: 'Replay commits on top of the base branch',
    icon: RiGitForkLine,
  },
} as const

type MergeMethod = keyof typeof MERGE_METHODS

function MergeSplitButton({ isPending, onMerge }: { isPending: boolean; onMerge: (method: MergeMethod) => void }) {
  const [preferred, setPreferred] = useState<MergeMethod>('squash')
  const info = MERGE_METHODS[preferred]
  const Icon = info.icon

  return (
    <div className="flex">
      <Button
        variant="outline"
        size="xs"
        className="flex-1 rounded-r-none border-emerald-800/50 text-emerald-300 hover:bg-emerald-900/40"
        disabled={isPending}
        onClick={() => onMerge(preferred)}
      >
        {isPending ? <RiLoader4Line className="animate-spin" /> : <Icon />}
        {info.label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex items-center justify-center size-6 rounded-sm rounded-l-none border border-l-0 border-emerald-800/50 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50 disabled:pointer-events-none transition-colors"
          disabled={isPending}
        >
          <RiArrowDownSLine className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-64">
          {(Object.entries(MERGE_METHODS) as [MergeMethod, (typeof MERGE_METHODS)[MergeMethod]][]).map(
            ([method, m]) => {
              const MIcon = m.icon
              return (
                <DropdownMenuItem
                  key={method}
                  onClick={() => {
                    setPreferred(method)
                    onMerge(method)
                  }}
                  className="flex flex-col items-start gap-0.5 py-2"
                >
                  <div className="flex items-center gap-1.5">
                    <MIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-medium">{m.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground ml-5">{m.description}</span>
                </DropdownMenuItem>
              )
            },
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
