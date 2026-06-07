import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RiCloseLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'

interface RecoveryBannerProps {
  recovered: number
  failed: number
  wasDirty: boolean
  onDismiss: () => void
}

export function RecoveryBanner({ recovered, failed, wasDirty, onDismiss }: RecoveryBannerProps) {
  const queryClient = useQueryClient()

  const failedSuffix = failed > 0 ? `, ${failed} failed` : ''
  const message = wasDirty
    ? `Wanda recovered from an unexpected shutdown. ${recovered} pod${recovered !== 1 ? 's' : ''} reconnected${failedSuffix}.`
    : `Reconnected ${recovered} pod${recovered !== 1 ? 's' : ''} from previous session${failedSuffix}.`

  const stopAllMutation = useMutation({
    ...orpcUtils.pod.stopAll.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pod'] })
      onDismiss()
    },
  })

  function handleStopAll() {
    stopAllMutation.mutate({})
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-b border-amber-800/30 border-l-2 border-l-amber-500 bg-amber-500/10 text-amber-200 text-[11px]">
      <span>{message}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {recovered > 0 && (
          <button
            type="button"
            onClick={handleStopAll}
            disabled={stopAllMutation.isPending}
            className="px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 transition-colors disabled:opacity-50"
          >
            {stopAllMutation.isPending ? 'Stopping...' : 'Stop All'}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="p-0.5 rounded-md hover:bg-amber-500/20 text-amber-300 transition-colors"
          title="Dismiss"
        >
          <RiCloseLine className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
