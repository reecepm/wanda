import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { use } from 'react'
import { toast } from 'sonner'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { RiArrowDownLine, RiArrowUpLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { type GitContext, GitManagerContext } from './context'

export function SyncButtons({ podId }: { podId: string }) {
  const queryClient = useQueryClient()
  const { collection } = use(GitManagerContext)!

  const { status: gitStatus, refresh: refreshGitStatus } = useGitStatus(podId)
  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const repoPath = (pod?.gitContext as GitContext | null)?.repoPath ?? pod?.cwd ?? null

  const hasUpstream = !!gitStatus?.local.upstream
  const hasRemote = !!gitStatus?.local.hasRemote
  const ahead = gitStatus?.local.ahead ?? 0
  const behind = gitStatus?.local.behind ?? 0

  const refresh = () => {
    void refreshGitStatus()
    queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey as string[]
        return Array.isArray(key) && key.some((k) => typeof k === 'string' && k.includes('getDiff'))
      },
    })
    if (repoPath) {
      queryClient.invalidateQueries({ queryKey: orpcUtils.app.getPRStatus.key({ input: { repoPath } }) })
    }
    collection.utils.refetch()
  }

  const pushMutation = useMutation({
    mutationFn: (opts?: { force?: boolean }) => orpcUtils.git.push.call({ podId, force: opts?.force }),
    onSettled: refresh,
  })

  const pullMutation = useMutation({
    mutationFn: () => orpcUtils.git.pull.call({ podId }),
    onSettled: refresh,
  })

  const showPush = hasRemote && (!hasUpstream || ahead > 0 || pushMutation.isPending)

  if (!hasRemote) return null

  return (
    <div className="flex gap-1.5">
      {hasUpstream && (
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          disabled={pullMutation.isPending}
          onClick={() =>
            pullMutation.mutate(undefined, {
              onSuccess: (r) => (r.success ? toast.success('Pulled') : toast.error(`Pull failed: ${r.error}`)),
              onError: (err) => toast.error(`Pull failed: ${err.message}`),
            })
          }
        >
          {pullMutation.isPending ? <RiLoader4Line className="animate-spin" /> : <RiArrowDownLine />}
          Pull{behind > 0 ? ` (${behind})` : ''}
        </Button>
      )}
      {showPush && (
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          disabled={pushMutation.isPending}
          onClick={() =>
            pushMutation.mutate(undefined, {
              onSuccess: (r) => (r.success ? toast.success('Pushed') : toast.error(`Push failed: ${r.error}`)),
              onError: (err) => toast.error(`Push failed: ${err.message}`),
            })
          }
        >
          {pushMutation.isPending ? <RiLoader4Line className="animate-spin" /> : <RiArrowUpLine />}
          {hasUpstream ? `Push${ahead > 0 ? ` (${ahead})` : ''}` : 'Publish'}
        </Button>
      )}
    </div>
  )
}
