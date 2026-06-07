import { use } from 'react'
import { highestPriority } from '@/features/notifications'
import { RiAddLine, RiArrowDownSLine, RiLayoutGridLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { AGENT_ATTENTION_DOT } from '../../utils/status-colors'
import { WorkspaceContextMenu } from '../workspace-context-menu'
import { WorkspaceListContext } from './context'
import { InlineRenameInput } from './inline-rename-input'
import type { Workspace } from './types'
import { WorkspaceAvatar } from './workspace-avatar'

/** Workspace folder header: avatar + name, attention dot, hover actions, and
 * the expand/collapse chevron. Wrapped in its own right-click context menu. */
export function WorkspaceHeader({
  workspace,
  isExpanded,
  onToggle,
  isWorkspaceViewActive,
  onCreatePod,
  onOpenProjectView,
  onWorkspaceSettings,
  onWorkspaceDelete,
  isRenamingWorkspace,
  onStartWorkspaceRename,
  onWorkspaceRenameSubmit,
  onWorkspaceRenameCancel,
  dragHandleProps,
}: {
  workspace: Workspace
  isExpanded: boolean
  onToggle: () => void
  isWorkspaceViewActive?: boolean
  onCreatePod: (workspaceId: string) => void
  onOpenProjectView?: (workspaceId: string) => void
  onWorkspaceSettings?: (workspaceId: string) => void
  onWorkspaceDelete?: (workspaceId: string) => void
  isRenamingWorkspace: boolean
  onStartWorkspaceRename: () => void
  onWorkspaceRenameSubmit: (name: string) => void
  onWorkspaceRenameCancel: () => void
  dragHandleProps: React.HTMLAttributes<HTMLDivElement>
}) {
  const { notificationCounts } = use(WorkspaceListContext)!
  const isRemoteWorkspace = !!workspace.serverId
  const workspacePriority = highestPriority(notificationCounts?.byWorkspace[workspace.id])
  const showAttentionDot = workspacePriority === 'blocking' || workspacePriority === 'urgent'

  return (
    <WorkspaceContextMenu
      onCreatePod={isRemoteWorkspace ? undefined : () => onCreatePod(workspace.id)}
      onOpenProjectView={onOpenProjectView ? () => onOpenProjectView(workspace.id) : undefined}
      onRename={onStartWorkspaceRename}
      onDelete={onWorkspaceDelete ? () => onWorkspaceDelete(workspace.id) : undefined}
      onSettings={!isRemoteWorkspace && onWorkspaceSettings ? () => onWorkspaceSettings(workspace.id) : undefined}
    >
      <div
        className="flex items-center group"
        data-wanda-workspace-row=""
        data-wanda-workspace-id={workspace.id}
        data-wanda-workspace-name={workspace.name}
        {...dragHandleProps}
      >
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-md text-left hover:bg-white/[0.04] transition-colors',
            isWorkspaceViewActive && 'bg-white/[0.06]',
          )}
        >
          <WorkspaceAvatar workspace={workspace} />
          {isRenamingWorkspace ? (
            <InlineRenameInput
              name={workspace.name}
              onSubmit={onWorkspaceRenameSubmit}
              onCancel={onWorkspaceRenameCancel}
            />
          ) : (
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span
                className={cn(
                  'text-[12px] font-medium truncate',
                  isWorkspaceViewActive ? 'text-zinc-200' : 'text-zinc-400',
                )}
              >
                {workspace.name}
              </span>
              {workspace.serverId && workspace.serverLabel && (
                <span
                  className="text-[10px] text-zinc-600 truncate font-normal shrink"
                  title={`Remote: ${workspace.serverLabel}`}
                >
                  · {workspace.serverLabel}
                </span>
              )}
            </div>
          )}
          {showAttentionDot && <span className={cn('h-2 w-2 rounded-full shrink-0', AGENT_ATTENTION_DOT)} />}
        </button>
        {onOpenProjectView && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpenProjectView(workspace.id)
            }}
            className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-all"
            title="Open project view"
          >
            <RiLayoutGridLine className="h-3.5 w-3.5" />
          </button>
        )}
        {!isRemoteWorkspace && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCreatePod(workspace.id)
            }}
            className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.08] opacity-0 group-hover:opacity-100 transition-all"
          >
            <RiAddLine className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          aria-label={isExpanded ? 'Collapse workspace' : 'Expand workspace'}
          className="h-7 w-6 mr-0.5 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-white/[0.08] transition-colors"
        >
          <RiArrowDownSLine
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-out',
              !isExpanded && '-rotate-90',
            )}
          />
        </button>
      </div>
    </WorkspaceContextMenu>
  )
}
