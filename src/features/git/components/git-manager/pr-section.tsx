import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ReactNode, useState } from 'react'
import { toast } from 'sonner'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { GIT_SETTINGS_KEYS } from '@/features/workspace'
import { RiGitPullRequestLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import type { GitContext, PRStatus } from './context'
import { CreateBranchPrompt } from './create-branch-prompt'
import { PRForm } from './pr-form'
import { PRStatusView } from './pr-status-view'

export type MergedWorktreePrompt = {
  repoPath: string
  worktreePath: string
  baseRefName: string
}

export function PRSection({ podId }: { podId: string }) {
  const [showForm, setShowForm] = useState(false)
  // PRStatusView unmounts once the PR status refetches after merge; keep the cleanup prompt above it.
  const [mergedWorktreePrompt, setMergedWorktreePrompt] = useState<MergedWorktreePrompt | null>(null)
  const [deleteWorktree, setDeleteWorktree] = useState(false)

  const { status: gitStatus } = useGitStatus(podId)
  const hasUpstream = !!gitStatus?.local.upstream
  const hasRemote = !!gitStatus?.local.hasRemote
  const branch = gitStatus?.local.branch ?? null
  const onDefaultBranch = !!(gitStatus?.local.isDefaultBranch ?? true)

  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const gitContext = pod?.gitContext as GitContext | null
  // Use cwd as fallback — that's where the branch is actually checked out
  const repoPath = gitContext?.repoPath ?? pod?.cwd ?? null
  const podName = pod?.name ?? 'this pod'

  const { data: ghStatus } = useQuery({
    ...orpcUtils.app.checkGitHubCli.queryOptions({}),
    staleTime: 300_000, // rarely changes mid-session
  })
  const { data: gitSettings } = useQuery(
    orpcUtils.settings.getMany.queryOptions({ input: { keys: [...GIT_SETTINGS_KEYS] } }),
  )

  const { data: prStatus } = useQuery({
    ...orpcUtils.app.getPRStatus.queryOptions({ input: { repoPath: repoPath! } }),
    // Only fetch PR status if branch is actually pushed (otherwise no PR can exist)
    enabled: !!repoPath && hasRemote && hasUpstream && !onDefaultBranch,
    staleTime: 15000,
    refetchInterval: 30000,
  }) as { data: PRStatus | null | undefined }

  function clearMergedWorktreePrompt() {
    setMergedWorktreePrompt(null)
    setDeleteWorktree(false)
  }

  const deleteMergedPod = useDeleteMergedPod(podId, clearMergedWorktreePrompt)

  let content: ReactNode = null

  // No remote → nothing to push to or create PRs against
  if (hasRemote) {
    if (onDefaultBranch) {
      content = <CreateBranchPrompt podId={podId} currentBranch={branch} />
    } else if (ghStatus && !ghStatus.authenticated) {
      // gh CLI not available — show install/auth message instead of PR actions
      content = (
        <div className="text-[10px] text-zinc-500 px-1">
          {!ghStatus.installed ? 'Install GitHub CLI (gh) to create PRs' : 'Sign in to GitHub CLI to create PRs'}
        </div>
      )
    } else if (prStatus && prStatus.state === 'OPEN') {
      content = (
        <PRStatusView
          podId={podId}
          prStatus={prStatus}
          gitContext={gitContext}
          onMergedWorktreePrompt={(prompt) => {
            setDeleteWorktree((gitSettings?.['git.worktreeCleanup'] ?? 'keep') === 'remove')
            setMergedWorktreePrompt(prompt)
          }}
        />
      )
    } else if (!prStatus && !showForm) {
      content = (
        <Button variant="outline" size="xs" className="w-full" onClick={() => setShowForm(true)}>
          <RiGitPullRequestLine />
          Create Pull Request
        </Button>
      )
    } else if (showForm && !prStatus) {
      content = <PRForm podId={podId} onCancel={() => setShowForm(false)} />
    }
  }

  return (
    <>
      {content}
      <MergedWorktreeDialog
        prompt={mergedWorktreePrompt}
        podName={podName}
        deleteWorktree={deleteWorktree}
        onDeleteWorktreeChange={setDeleteWorktree}
        onClose={clearMergedWorktreePrompt}
        onConfirm={() => mergedWorktreePrompt && deleteMergedPod(mergedWorktreePrompt, deleteWorktree)}
      />
    </>
  )
}

function MergedWorktreeDialog({
  prompt,
  podName,
  deleteWorktree,
  onDeleteWorktreeChange,
  onClose,
  onConfirm,
}: {
  prompt: MergedWorktreePrompt | null
  podName: string
  deleteWorktree: boolean
  onDeleteWorktreeChange: (value: boolean) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={!!prompt}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-96" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>PR merged</DialogTitle>
        </DialogHeader>
        {prompt && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-400">
              <span className="text-zinc-200 font-medium">{podName}</span> is a worktree pod, so we can&apos;t
              auto-switch to {prompt.baseRefName}. Delete the pod (and its worktree), or leave it as is?
            </p>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <Checkbox checked={deleteWorktree} onCheckedChange={(v) => onDeleteWorktreeChange(!!v)} />
              Also delete worktree at{' '}
              <code className="text-zinc-300 bg-zinc-800 px-1 py-0.5 rounded text-[10px] break-all">
                {prompt.worktreePath}
              </code>
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Leave as is
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Delete pod
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useDeleteMergedPod(podId: string, onBeforeDelete: () => void) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { activePodId, setActivePodId } = useUIStore()

  return (prompt: MergedWorktreePrompt, deleteWorktree: boolean) => {
    const { repoPath, worktreePath } = prompt

    // Close the dialog and navigate away first so the user can watch the
    // deletion play out in the sidebar instead of being stuck on the pod view
    // while cleanup runs.
    onBeforeDelete()
    if (activePodId === podId) {
      setActivePodId(null)
      navigate({ to: '/' })
    }

    void (async () => {
      if (deleteWorktree) {
        // Best-effort: a failing worktree remove (uncommitted changes,
        // locked, etc.) shouldn't block the pod delete the user explicitly
        // asked for. Surface the error and continue.
        try {
          await orpcUtils.app.removeWorktree.call({ repoPath, directory: worktreePath })
        } catch (err) {
          toast.error(`Failed to remove worktree: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      }
      try {
        await orpcUtils.pod.delete.call({ id: podId })
      } catch (err) {
        toast.error(`Failed to delete pod: ${err instanceof Error ? err.message : 'unknown error'}`)
        return
      }
      // Refresh any pod list query so the deleted pod disappears from the sidebar.
      queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey as unknown[]
          return Array.isArray(key) && key.some((k) => typeof k === 'string' && k.includes('pod'))
        },
      })
    })()
  }
}
