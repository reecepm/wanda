import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useMemo, useRef, useState } from 'react'
import { WorkspaceListContext, type WorkspaceListContextValue } from './workspace-list/context'
import { DeleteWorkspaceDialog } from './workspace-list/delete-workspace-dialog'
import { SortableWorkspace } from './workspace-list/sortable-workspace'
import type { PodMenuCallbacks, WorkspaceListProps } from './workspace-list/types'
import { WorkspaceListEmpty } from './workspace-list/workspace-list-empty'

export type {
  AgentStatus,
  AgentSummary,
  ChatSessionSummary,
  PodRuntimeKind,
  PodSummary,
  Workspace,
} from './workspace-list/types'

export function WorkspaceList({
  workspaces,
  selectedPodId,
  selectedWorkspaceViewId,
  expandedWorkspaces = new Set<string>(),
  onToggleWorkspace,
  notificationCounts,
  onSelectPod,
  onCreateWorkspace,
  onCreatePod,
  onOpenProjectView,
  onWorkspaceSettings,
  onWorkspaceRename,
  onWorkspaceDelete,
  onReorderWorkspaces,
  onReorderPods,
  onPodStart,
  onPodStop,
  onPodRestart,
  onPodRename,
  onPodDuplicate,
  onPodDelete,
  onPodOpenInEditor,
  onPodMoveToWorkspace,
  onPodSaveAsTemplate,
  onPodBranchOff,
  onPodSettings,
  editors,
  selectedAgentId,
  onSelectAgent,
  selectedChatSessionItemId,
  onSelectChatSession,
}: WorkspaceListProps) {
  const [orderedWorkspaceIds, setOrderedWorkspaceIds] = useState<string[] | null>(null)
  const localWorkspaces = useMemo(() => {
    if (!orderedWorkspaceIds) return workspaces
    const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
    const ordered = orderedWorkspaceIds.flatMap((id) => {
      const workspace = workspacesById.get(id)
      return workspace ? [workspace] : []
    })
    const orderedIds = new Set(orderedWorkspaceIds)
    return [...ordered, ...workspaces.filter((workspace) => !orderedIds.has(workspace.id))]
  }, [workspaces, orderedWorkspaceIds])

  const containerRef = useRef<HTMLDivElement>(null)

  const [renamingPodId, setRenamingPodId] = useState<string | null>(null)
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null)
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const boundedModifiers: Modifier[] = useMemo(
    () => [
      ({ transform, activeNodeRect }) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect || !activeNodeRect) return { ...transform, x: 0 }
        return {
          ...transform,
          x: 0,
          y: Math.min(Math.max(transform.y, rect.top - activeNodeRect.top), rect.bottom - activeNodeRect.bottom),
        }
      },
    ],
    [],
  )

  function handleWorkspaceDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = localWorkspaces.findIndex((p) => p.id === String(active.id))
    const newIndex = localWorkspaces.findIndex((p) => p.id === String(over.id))
    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(localWorkspaces, oldIndex, newIndex)
      setOrderedWorkspaceIds(reordered.map((p) => p.id))
      onReorderWorkspaces?.(reordered.map((p) => p.id))
    }
  }

  const handlePodRenameSubmit = useCallback(
    (podId: string, name: string) => {
      setRenamingPodId(null)
      onPodRename?.(podId, name)
    },
    [onPodRename],
  )

  const handlePodRenameCancel = useCallback(() => {
    setRenamingPodId(null)
  }, [])

  const handleWorkspaceRenameSubmit = useCallback(
    (workspaceId: string, name: string) => {
      setRenamingWorkspaceId(null)
      onWorkspaceRename?.(workspaceId, name)
    },
    [onWorkspaceRename],
  )

  const handleWorkspaceRenameCancel = useCallback(() => {
    setRenamingWorkspaceId(null)
  }, [])

  function handleConfirmWorkspaceDelete() {
    if (deletingWorkspaceId) {
      onWorkspaceDelete?.(deletingWorkspaceId)
      setDeletingWorkspaceId(null)
    }
  }

  const deletingWorkspace = deletingWorkspaceId ? localWorkspaces.find((p) => p.id === deletingWorkspaceId) : null

  const podMenuCallbacks: PodMenuCallbacks = useMemo(
    () => ({
      onPodStart,
      onPodStop,
      onPodRestart,
      onPodDuplicate,
      onPodDelete: (podId: string) => onPodDelete?.(podId),
      onPodOpenInEditor,
      onPodMoveToWorkspace,
      onPodSaveAsTemplate,
      onPodBranchOff,
      onPodSettings,
      editors,
      workspaces: localWorkspaces.map((p) => ({ id: p.id, name: p.name })),
    }),
    [
      onPodStart,
      onPodStop,
      onPodRestart,
      onPodDuplicate,
      onPodDelete,
      onPodOpenInEditor,
      onPodMoveToWorkspace,
      onPodSaveAsTemplate,
      onPodBranchOff,
      onPodSettings,
      editors,
      localWorkspaces,
    ],
  )

  const contextValue = useMemo<WorkspaceListContextValue>(
    () => ({
      notificationCounts,
      podMenuCallbacks,
      selectedAgentId,
      onSelectAgent,
      selectedChatSessionItemId,
      onSelectChatSession,
    }),
    [
      notificationCounts,
      podMenuCallbacks,
      selectedAgentId,
      onSelectAgent,
      selectedChatSessionItemId,
      onSelectChatSession,
    ],
  )

  if (localWorkspaces.length === 0) {
    return <WorkspaceListEmpty onCreateWorkspace={onCreateWorkspace} />
  }

  const workspaceIds = localWorkspaces.map((p) => p.id)

  return (
    <WorkspaceListContext value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={boundedModifiers}
        onDragEnd={handleWorkspaceDragEnd}
      >
        <div ref={containerRef} className="flex flex-col p-1.5">
          <SortableContext items={workspaceIds} strategy={verticalListSortingStrategy}>
            {localWorkspaces.map((workspace) => (
              <SortableWorkspace
                key={workspace.id}
                workspace={workspace}
                isExpanded={expandedWorkspaces.has(workspace.id)}
                onToggle={() => onToggleWorkspace(workspace.id)}
                selectedPodId={selectedPodId}
                isWorkspaceViewActive={selectedWorkspaceViewId === workspace.id}
                onSelectPod={onSelectPod}
                onCreatePod={onCreatePod}
                onOpenProjectView={onOpenProjectView}
                onWorkspaceSettings={onWorkspaceSettings}
                onWorkspaceDelete={onWorkspaceDelete ? (id) => setDeletingWorkspaceId(id) : undefined}
                isRenamingWorkspace={renamingWorkspaceId === workspace.id}
                onStartWorkspaceRename={() => setRenamingWorkspaceId(workspace.id)}
                onWorkspaceRenameSubmit={(name) => handleWorkspaceRenameSubmit(workspace.id, name)}
                onWorkspaceRenameCancel={handleWorkspaceRenameCancel}
                onReorderPods={onReorderPods}
                renamingPodId={renamingPodId}
                onStartPodRename={(podId) => setRenamingPodId(podId)}
                onPodRenameSubmit={handlePodRenameSubmit}
                onPodRenameCancel={handlePodRenameCancel}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>

      <DeleteWorkspaceDialog
        workspaceName={deletingWorkspace?.name}
        open={deletingWorkspaceId !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingWorkspaceId(null)
        }}
        onConfirm={handleConfirmWorkspaceDelete}
      />
    </WorkspaceListContext>
  )
}
