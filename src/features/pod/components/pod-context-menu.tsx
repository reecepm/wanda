import type { PodSummary } from '@/features/workspace'
import {
  RiCodeSSlashLine,
  RiDeleteBinLine,
  RiDragMoveLine,
  RiEditLine,
  RiFileCopyLine,
  RiGitBranchLine,
  RiLayoutGridLine,
  RiPlayLine,
  RiRestartLine,
  RiSettings3Line,
  RiStopLine,
} from '@/lib/icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/ui/context-menu'

interface PodContextMenuProps {
  pod: PodSummary
  children: React.ReactNode
  onStart: () => void
  onStop: () => void
  onRestart: () => void
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
  editors?: { id: string; name: string }[]
  workspaces?: { id: string; name: string }[]
  onOpenInEditor?: (editorId: string) => void
  onMoveToWorkspace?: (workspaceId: string) => void
  onSaveAsTemplate?: () => void
  onBranchOff?: () => void
  onSettings?: () => void
}

export function PodContextMenu({
  pod,
  children,
  onStart,
  onStop,
  onRestart,
  onRename,
  onDuplicate,
  onDelete,
  editors,
  workspaces,
  onOpenInEditor,
  onMoveToWorkspace,
  onSaveAsTemplate,
  onBranchOff,
  onSettings,
}: PodContextMenuProps) {
  const isLocalPty = pod.runtimeKind === 'shell'
  const canStart = !isLocalPty && (pod.status === 'stopped' || pod.status === 'failed')
  const canStop = !isLocalPty && pod.status === 'running'

  const hasEditors = editors && editors.length > 0
  const otherWorkspaces = workspaces?.filter((p) => p.id !== pod.workspaceId)
  const hasWorkspaces = otherWorkspaces && otherWorkspaces.length > 0

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {canStart && (
          <ContextMenuItem onClick={() => onStart()}>
            <RiPlayLine />
            Start
          </ContextMenuItem>
        )}
        {canStop && (
          <>
            <ContextMenuItem onClick={() => onStop()}>
              <RiStopLine />
              Stop
              <ContextMenuShortcut>&#8984;&#8679;S</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onRestart()}>
              <RiRestartLine />
              Restart
              <ContextMenuShortcut>&#8984;&#8679;R</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        {(canStart || canStop) && <ContextMenuSeparator />}
        <ContextMenuItem onClick={() => onRename()}>
          <RiEditLine />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onDuplicate()}>
          <RiFileCopyLine />
          Duplicate
        </ContextMenuItem>
        {onSaveAsTemplate && (
          <ContextMenuItem onClick={() => onSaveAsTemplate()}>
            <RiLayoutGridLine />
            Save as Template
          </ContextMenuItem>
        )}
        {pod.hasWorktree && onBranchOff && (
          <ContextMenuItem onClick={() => onBranchOff()}>
            <RiGitBranchLine />
            Branch off
          </ContextMenuItem>
        )}
        {hasEditors && editors.length === 1 && editors[0] && (
          <ContextMenuItem onClick={() => onOpenInEditor?.(editors[0]!.id)}>
            <RiCodeSSlashLine />
            Open in Editor
            <ContextMenuShortcut>&#8984;&#8679;E</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {hasEditors && editors.length > 1 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <RiCodeSSlashLine />
              Open in Editor
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {editors.map((editor) => (
                <ContextMenuItem key={editor.id} onClick={() => onOpenInEditor?.(editor.id)}>
                  {editor.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {hasWorkspaces && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <RiDragMoveLine />
              Move to Workspace
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {otherWorkspaces.map((ws) => (
                <ContextMenuItem key={ws.id} onClick={() => onMoveToWorkspace?.(ws.id)}>
                  {ws.name}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {onSettings && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onSettings()}>
              <RiSettings3Line />
              Pod Settings
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDelete()}>
          <RiDeleteBinLine />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
