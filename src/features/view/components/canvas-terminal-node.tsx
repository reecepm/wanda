import { type NodeProps, NodeResizer } from '@xyflow/react'
import { memo, useContext } from 'react'
import { focusItem, requestItemClose } from '@/features/pod/utils/item-utils'
import { toViewItem } from '@/features/pod/utils/terminal-utils'
import { useActiveCanvasNodeIndex, useFocusedItemId, usePodItem, useViewStore } from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { RiCloseLine, RiDeleteBinLine, RiEditLine } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { useFocusBorder } from '@/stores/appearance-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { AddItemMenuItems } from './add-item-menu'
import { CanvasViewContext } from './canvas-view'
import { AgentBadge, ItemIcon, PodPill } from './item-chrome'
import { TabContent } from './tab-content'

const EMPTY_TERMINAL_CONFIG = { podTerminalId: '' } as const

interface CanvasNodeData {
  itemId: string
  [key: string]: unknown
}

export const CanvasTerminalNode = memo(function CanvasTerminalNode({ data, selected }: NodeProps) {
  const { itemId } = data as CanvasNodeData
  const ctx = useContext(CanvasViewContext)
  const { runningTerminals, onTerminalsChanged, onTerminalRemoved } = useTerminalRender()

  // All hooks must be called unconditionally (Rules of Hooks)
  const focusBorder = useFocusBorder()
  const focusPane = useViewStore((s) => s.focusPane)
  const renamePodItem = useViewStore((s) => s.renamePodItem)
  const focusedItemId = useFocusedItemId()
  const nodeIndex = useActiveCanvasNodeIndex(itemId)
  const podItem = usePodItem(itemId)

  // Editing state — hook must be called unconditionally (before early return)
  const { isEditing, editValue, setEditValue, inputRef, startEditing, commitRename, cancelEditing } = useInlineEdit(
    (value) => renamePodItem(itemId, value),
  )

  if (!ctx) return null

  const { autoRenamePodItem, actions } = ctx

  const isFocused = focusedItemId === itemId
  const label = podItem?.label ?? 'Unknown'

  const viewItem = podItem ? toViewItem(podItem) : null

  function handleFocus() {
    focusPane(itemId)
    if (podItem) focusItem(podItem, runningTerminals)
  }

  function handleDelete() {
    if (!podItem) return
    requestItemClose(podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
  }

  return (
    <div
      className={`flex flex-col h-full w-full rounded-md overflow-hidden border ${isFocused ? focusBorder : 'border-zinc-800'} bg-zinc-950`}
      data-focused={isFocused || undefined}
      onMouseDown={handleFocus}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={300}
        minHeight={200}
        lineClassName="!border-zinc-600"
        handleClassName="!w-2 !h-2 !bg-zinc-500 !border-zinc-600"
      />

      {/* Header — drag handle */}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className={`canvas-node-header group flex items-center h-8 px-2 border-b shrink-0 cursor-grab active:cursor-grabbing ${isFocused ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950 border-zinc-800'}`}
              onDoubleClick={() => startEditing(label)}
            />
          }
        >
          <PodPill podId={podItem?.podId} />
          <ItemIcon
            contentType={viewItem?.contentType ?? 'terminal'}
            config={viewItem?.config}
            className="h-3.5 w-3.5 text-zinc-600 shrink-0 mr-1.5"
          />

          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelEditing()
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent border-none outline-none text-xs text-zinc-200 w-[100px] py-0 nodrag"
            />
          ) : (
            <>
              <span className="text-xs text-zinc-400 truncate min-w-0">{label}</span>
              {nodeIndex >= 0 && nodeIndex < 9 && (
                <span className="ml-1.5 shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
                  &#8984;{nodeIndex + 1}
                </span>
              )}
            </>
          )}

          <div className="flex-1" />
          <AgentBadge
            contentType={viewItem?.contentType ?? 'terminal'}
            config={viewItem?.config ?? EMPTY_TERMINAL_CONFIG}
          />

          {!isEditing && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors nodrag"
                title="Delete"
              >
                <RiCloseLine className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => startEditing(label)}>
            <RiEditLine />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <AddItemMenuItems variant="context" actions={actions} />
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => handleDelete()}>
            <RiDeleteBinLine />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Content area */}
      <div className="relative flex-1 min-h-0 bg-zinc-950 nodrag">
        {viewItem ? (
          <TabContent item={viewItem} onTitleChange={autoRenamePodItem} onChanged={onTerminalsChanged} />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-xs">Item not found</div>
        )}
      </div>
    </div>
  )
})
