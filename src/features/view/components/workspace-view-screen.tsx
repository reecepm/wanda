import { useHotkey } from '@tanstack/react-hotkeys'
import { useCallback, useEffect, useMemo } from 'react'
import { buildAddItemActions } from '@/features/pod/utils/add-item-actions'
import { useUIStore } from '@/stores/ui-store'
import { useItemPicker } from '../hooks/use-item-picker'
import { useWorkspaceViewData } from '../hooks/use-workspace-view-data'
import { useWorkspaceViewLifecycle } from '../hooks/use-workspace-view-lifecycle'
import { VIEW_SCOPE_CONFIGS, ViewScopeProvider } from '../scope'
import { flushDebouncedPersist } from '../store/persistence-strategy'
import { useViewCallbacks } from '../store/view-callbacks'
import { useViewStore } from '../store/view-store'
import { ActiveViewRenderer } from './active-view-renderer'
import { ItemPicker } from './item-picker'
import { WorkspaceTopBar } from './workspace-top-bar'

export function WorkspaceViewScreen({ workspaceId }: { workspaceId: string }) {
  const setActiveWorkspaceViewId = useUIStore((s) => s.setActiveWorkspaceViewId)
  const { openPicker } = useItemPicker()
  useHotkey('Mod+T', (e) => {
    e.preventDefault()
    openPicker()
  })
  const data = useWorkspaceViewData(workspaceId)
  const {
    workspace,
    pods,
    podItems,
    views,
    terminalConfigs,
    runningTerminals,
    commandConfigs,
    runningCommands,
    detectedEditors,
    activeViewId,
    isLoading,
  } = data

  useWorkspaceViewLifecycle({
    workspaceId,
    podItems,
    views,
    terminalConfigs,
    commandConfigs,
    activeViewId,
    isLoading,
  })

  // Track active workspace in UI store for sidebar highlighting
  useEffect(() => {
    setActiveWorkspaceViewId(workspaceId)
    return () => {
      setActiveWorkspaceViewId(null)
      flushDebouncedPersist()
    }
  }, [workspaceId, setActiveWorkspaceViewId])

  // Memoize scope context value to prevent re-render cascades
  const scopeValue = useMemo(
    () => ({ config: VIEW_SCOPE_CONFIGS.workspace, scope: 'workspace' as const, entityId: workspaceId, pods }),
    [workspaceId, pods],
  )

  const onTerminalsChanged = useCallback(() => {
    // Workspace view relies on batch queries; they'll refresh via polling/invalidation
  }, [])

  const onTerminalRemoved = useCallback(() => {
    // No-op at workspace scope — batch queries handle it
  }, [])

  const storeReady = useViewStore((s) => !!s.entities[workspaceId])

  const pickerCommandIdsInView = useMemo(() => {
    return new Set(
      podItems
        .filter((item) => item.contentType === 'command')
        .map((item) => (item.config as { podCommandId?: string }).podCommandId)
        .filter((id): id is string => typeof id === 'string'),
    )
  }, [podItems])

  const pickerPlaceItem = useCallback((item: { id: string }) => {
    const placeFn = useViewCallbacks.getState().viewPlaceItem
    if (placeFn) placeFn(item.id)
    else useViewStore.getState().splitPane('horizontal', item.id)
  }, [])

  const makePickerActionsForPod = useCallback(
    (selectedPodId: string) =>
      buildAddItemActions({
        podId: selectedPodId,
        isRunning: true,
        terminalCount: terminalConfigs.filter((t) => ('podId' in t ? t.podId === selectedPodId : false)).length,
        commandConfigs,
        commandIdsInView: pickerCommandIdsInView,
        commandsNotInView: commandConfigs.filter((cmd) => !pickerCommandIdsInView.has(cmd.id)),
        placeItem: pickerPlaceItem,
        onItemsChanged: onTerminalsChanged,
      }),
    [terminalConfigs, commandConfigs, pickerCommandIdsInView, pickerPlaceItem, onTerminalsChanged],
  )

  const pickerActions = useMemo(
    () => makePickerActionsForPod(pods[0]?.id ?? workspaceId),
    [makePickerActionsForPod, pods, workspaceId],
  )

  if (isLoading || !workspace || !storeReady) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-sm">Loading workspace view...</div>
    )
  }

  return (
    <ViewScopeProvider value={scopeValue}>
      <div className="flex flex-col h-full">
        <WorkspaceTopBar workspaceId={workspaceId} pods={pods} detectedEditors={detectedEditors} />
        <ActiveViewRenderer
          podId={pods[0]?.id ?? workspaceId}
          podStatus="running"
          runningTerminals={runningTerminals}
          terminalConfigs={terminalConfigs}
          commandConfigs={commandConfigs}
          runningCommands={runningCommands}
          onTerminalsChanged={onTerminalsChanged}
          onTerminalRemoved={onTerminalRemoved}
        />
        <ItemPicker actions={pickerActions} actionsForPod={makePickerActionsForPod} />
      </div>
    </ViewScopeProvider>
  )
}
