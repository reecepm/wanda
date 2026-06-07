import { RiAddLine, RiDeleteBinLine, RiEditLine, RiLayoutGridLine, RiSettings3Line } from '@/lib/icons'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'

interface WorkspaceContextMenuProps {
  children: React.ReactNode
  onCreatePod?: () => void
  onOpenProjectView?: () => void
  onRename: () => void
  onDelete?: () => void
  onSettings?: () => void
}

export function WorkspaceContextMenu({
  children,
  onCreatePod,
  onOpenProjectView,
  onRename,
  onDelete,
  onSettings,
}: WorkspaceContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {onCreatePod && (
          <ContextMenuItem onClick={onCreatePod}>
            <RiAddLine />
            New pod
          </ContextMenuItem>
        )}
        {onOpenProjectView && (
          <ContextMenuItem onClick={onOpenProjectView}>
            <RiLayoutGridLine />
            Open project view
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>
          <RiEditLine />
          Rename
        </ContextMenuItem>
        {onSettings && (
          <ContextMenuItem onClick={onSettings}>
            <RiSettings3Line />
            Settings
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDelete} className="text-red-400 focus:text-red-300">
              <RiDeleteBinLine />
              Delete workspace
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
