import { useUIStore } from '@/stores/ui-store'
import { usePendingPods } from './use-pending-pods'
import { useResolveClient } from './use-resolve-client'
import { useWorkspaceExplorerData } from './use-workspace-explorer-data'
import { useWorkspaceExplorerHandlers } from './use-workspace-explorer-handlers'

export { GIT_SETTINGS_KEYS, resolveBranchName, resolveBranchPrefix, resolveWorktreeDir } from './worktree'

/**
 * Top-level sidebar hook. Composes four focused sub-hooks:
 *
 *   - usePendingPods           optimistic create/delete progress state
 *   - useResolveClient         local ↔ paired-server client resolver
 *   - useWorkspaceExplorerData query fan-out → combined workspace tree
 *   - useWorkspaceExplorerHandlers  context-menu mutations
 *
 * and flattens their outputs into the single object the sidebar consumes.
 */
export function useWorkspaceExplorer() {
  const { activePodId, activeWorkspaceViewId } = useUIStore()

  const pending = usePendingPods()
  const resolveClient = useResolveClient()
  const data = useWorkspaceExplorerData(pending.pendingPods)

  const handlers = useWorkspaceExplorerHandlers({
    resolveClient,
    beginPendingPod: pending.beginPendingPod,
    beginExistingPodProgress: pending.beginExistingPodProgress,
    updatePendingPod: pending.updatePendingPod,
    clearPendingPod: pending.clearPendingPod,
    finishPendingPod: pending.finishPendingPod,
    failPendingPod: pending.failPendingPod,
    pendingByWorkenvIdRef: pending.pendingByWorkenvIdRef,
    workspacesRaw: data.workspacesRaw,
    podQueries: data.podQueries,
    gitSettings: data.gitSettings,
    workspaceSettingsMap: data.workspaceSettingsMap,
  })

  return {
    workspaces: data.workspaces,
    workspacesRaw: data.workspacesRaw,
    detectedEditors: data.detectedEditors,
    effectiveExpanded: data.effectiveExpanded,
    activePodId,
    activeWorkspaceViewId,
    gitSettings: data.gitSettings,

    handleSelectPod: handlers.handleSelectPod,
    handleSelectAgent: handlers.handleSelectAgent,
    handleSelectChatSession: handlers.handleSelectChatSession,
    workspaceSettingsMap: data.workspaceSettingsMap,
    handleCreatePod: handlers.handleCreatePod,
    handleQuickCreatePod: handlers.handleQuickCreatePod,
    handleReorderWorkspaces: handlers.handleReorderWorkspaces,
    handleReorderPods: handlers.handleReorderPods,
    handleWorkspaceDelete: handlers.handleWorkspaceDelete,
    handlePodStart: handlers.handlePodStart,
    handlePodStop: handlers.handlePodStop,
    handlePodRestart: handlers.handlePodRestart,
    handlePodRename: handlers.handlePodRename,
    handlePodDuplicate: handlers.handlePodDuplicate,
    handlePodDelete: handlers.handlePodDelete,
    handlePodOpenInEditor: handlers.handlePodOpenInEditor,
    handlePodMoveToWorkspace: handlers.handlePodMoveToWorkspace,
    handlePodSaveAsTemplate: handlers.handlePodSaveAsTemplate,
    handlePodBranchOff: handlers.handlePodBranchOff,
    handleWorkspaceRename: handlers.handleWorkspaceRename,
    pendingWorktreeCleanup: handlers.pendingWorktreeCleanup,
    confirmWorktreeCleanup: handlers.confirmWorktreeCleanup,
  }
}
