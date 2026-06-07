import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/shared/utils'
import { SortablePodList } from './sortable-pod-list'
import type { Workspace } from './types'
import { WorkspaceHeader } from './workspace-header'

export function SortableWorkspace({
  workspace,
  isExpanded,
  onToggle,
  selectedPodId,
  isWorkspaceViewActive,
  onSelectPod,
  onCreatePod,
  onOpenProjectView,
  onWorkspaceSettings,
  onWorkspaceDelete,
  isRenamingWorkspace,
  onStartWorkspaceRename,
  onWorkspaceRenameSubmit,
  onWorkspaceRenameCancel,
  onReorderPods,
  renamingPodId,
  onStartPodRename,
  onPodRenameSubmit,
  onPodRenameCancel,
}: {
  workspace: Workspace
  isExpanded: boolean
  onToggle: () => void
  selectedPodId?: string
  isWorkspaceViewActive?: boolean
  onSelectPod: (podId: string) => void
  onCreatePod: (workspaceId: string) => void
  onOpenProjectView?: (workspaceId: string) => void
  onWorkspaceSettings?: (workspaceId: string) => void
  onWorkspaceDelete?: (workspaceId: string) => void
  isRenamingWorkspace: boolean
  onStartWorkspaceRename: () => void
  onWorkspaceRenameSubmit: (name: string) => void
  onWorkspaceRenameCancel: () => void
  onReorderPods?: (workspaceId: string, podIds: string[]) => void
  renamingPodId: string | null
  onStartPodRename: (podId: string) => void
  onPodRenameSubmit: (podId: string, name: string) => void
  onPodRenameCancel: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'z-10 opacity-90 rounded-lg bg-zinc-900 shadow-lg ring-1 ring-white/[0.06]')}
    >
      <WorkspaceHeader
        workspace={workspace}
        isExpanded={isExpanded}
        onToggle={onToggle}
        isWorkspaceViewActive={isWorkspaceViewActive}
        onCreatePod={onCreatePod}
        onOpenProjectView={onOpenProjectView}
        onWorkspaceSettings={onWorkspaceSettings}
        onWorkspaceDelete={onWorkspaceDelete}
        isRenamingWorkspace={isRenamingWorkspace}
        onStartWorkspaceRename={onStartWorkspaceRename}
        onWorkspaceRenameSubmit={onWorkspaceRenameSubmit}
        onWorkspaceRenameCancel={onWorkspaceRenameCancel}
        dragHandleProps={{ ...attributes, ...listeners }}
      />

      {/* Accordion reveal */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className={cn(
              'flex flex-col gap-0.5 pt-0.5 transition-opacity duration-200',
              isExpanded ? 'opacity-100' : 'opacity-0',
            )}
          >
            {workspace.pods.length === 0 ? (
              <p className="text-[11px] text-zinc-700 px-4 py-2 italic">No pods yet</p>
            ) : (
              <SortablePodList
                workspace={workspace}
                selectedPodId={selectedPodId}
                onSelectPod={onSelectPod}
                onReorderPods={onReorderPods}
                renamingPodId={renamingPodId}
                onStartRename={onStartPodRename}
                onRenameSubmit={onPodRenameSubmit}
                onRenameCancel={onPodRenameCancel}
              />
            )}
            {/* Bottom breathing room — visual separation between open folders */}
            <div className="h-3" />
          </div>
        </div>
      </div>
    </div>
  )
}
