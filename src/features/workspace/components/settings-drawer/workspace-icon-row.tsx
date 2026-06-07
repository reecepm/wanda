import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { RiRefreshLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { FieldHint, FieldLabel } from './fields'

export function WorkspaceIconRow({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const queryClient = useQueryClient()
  const { data: workspace } = useQuery({
    ...orpcUtils.workspace.getById.queryOptions({ input: { id: workspaceId } }),
  })
  const [refreshing, setRefreshing] = useState(false)
  const [errored, setErrored] = useState(false)

  const iconUrl = workspace?.iconUrl ?? null
  const initial = (workspaceName.trim().charAt(0) || '?').toUpperCase()
  const showImage = !!iconUrl && !errored

  async function handleRefresh() {
    setRefreshing(true)
    setErrored(false)
    try {
      await orpcUtils.workspace.refreshIcon.call({ id: workspaceId })
      queryClient.invalidateQueries({
        queryKey: orpcUtils.workspace.getById.key({ input: { id: workspaceId } }),
      })
      queryClient.invalidateQueries({ queryKey: orpcUtils.workspace.list.key() })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh icon')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Icon</FieldLabel>
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 shrink-0 rounded-md overflow-hidden flex items-center justify-center bg-zinc-800 ring-1 ring-inset ring-white/[0.04] text-zinc-400 text-[11px] font-semibold">
          {showImage ? (
            <img
              src={iconUrl!}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              onError={() => setErrored(true)}
            />
          ) : (
            <span>{initial}</span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RiRefreshLine className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh from git remote'}
        </Button>
      </div>
      <FieldHint>
        Derived from the repo's git remote (e.g. GitHub org/user avatar). Refresh after changing remotes.
      </FieldHint>
    </div>
  )
}
