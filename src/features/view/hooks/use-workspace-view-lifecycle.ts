import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import { usePodStatusChange } from '@/features/pod/hooks/use-pod-lifecycle'
import { type PodItem, useViewStore } from '@/features/view/store/view-store'
import { orpcUtils } from '@/shared/orpc'
import type { CommandItemConfig, TerminalItemConfig, ViewConfig, ViewItemSettings } from '@/types/schema'

interface WorkspaceViewLifecycleArgs {
  workspaceId: string
  podItems: PodItem[]
  views: {
    id: string
    name: string
    viewType: string
    config?: ViewConfig | null
    itemSettings: Record<string, ViewItemSettings>
  }[]
  terminalConfigs: { id: string; podId: string }[]
  commandConfigs: { id: string; podId: string }[]
  activeViewId: string | null
  isLoading: boolean
}

function filterValidItems(
  podItems: PodItem[],
  terminalConfigs: { id: string }[],
  commandConfigs: { id: string }[],
): PodItem[] {
  const validTerminalIds = new Set(terminalConfigs.map((t) => t.id))
  const validCommandIds = new Set(commandConfigs.map((c) => c.id))
  return podItems.filter((pi) => {
    if (pi.contentType === 'terminal' || pi.contentType === 'agent')
      return validTerminalIds.has((pi.config as TerminalItemConfig).podTerminalId)
    if (pi.contentType === 'command') return validCommandIds.has((pi.config as CommandItemConfig).podCommandId)
    return true
  })
}

export function useWorkspaceViewLifecycle({
  workspaceId,
  podItems,
  views,
  terminalConfigs,
  commandConfigs,
  activeViewId,
  isLoading,
}: WorkspaceViewLifecycleArgs) {
  const queryClient = useQueryClient()
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isLoading && views.length === 0 && loadedRef.current !== workspaceId) {
      orpcUtils.workspaceView.ensureDefault.call({ workspaceId }).then(() => {
        queryClient.invalidateQueries({ queryKey: orpcUtils.workspaceView.list.queryKey({ input: { workspaceId } }) })
        queryClient.invalidateQueries({
          queryKey: orpcUtils.workspace.getById.queryKey({ input: { id: workspaceId } }),
        })
      })
    }
  }, [isLoading, views.length, workspaceId, queryClient])

  useEffect(() => {
    if (loadedRef.current === workspaceId) return
    if (isLoading || views.length === 0) return

    const filteredItems = filterValidItems(podItems, terminalConfigs, commandConfigs)
    useViewStore.getState().load(workspaceId, views, filteredItems, activeViewId, 'workspace')
    loadedRef.current = workspaceId
  }, [podItems, views, terminalConfigs, commandConfigs, activeViewId, isLoading, workspaceId])

  // Reconcile when items change (picks up new items created in pod views)
  useEffect(() => {
    if (loadedRef.current !== workspaceId) return
    const filteredItems = filterValidItems(podItems, terminalConfigs, commandConfigs)
    if (filteredItems.length > 0) {
      useViewStore.getState().reconcile(filteredItems)
    }
  }, [podItems, terminalConfigs, commandConfigs, workspaceId])

  usePodStatusChange(
    useCallback(() => {
      queryClient.invalidateQueries({
        queryKey: orpcUtils.workspaceView.aggregatedItems.queryKey({ input: { workspaceId } }),
      })
      queryClient.invalidateQueries({
        queryKey: orpcUtils.workspaceView.aggregatedConfigs.queryKey({ input: { workspaceId } }),
      })
      queryClient.invalidateQueries({
        queryKey: orpcUtils.workspaceView.aggregatedRunningState.queryKey({ input: { workspaceId } }),
      })
    }, [queryClient, workspaceId]),
  )

  useEffect(() => {
    return () => {
      loadedRef.current = null
    }
  }, [])
}
