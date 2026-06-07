import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useMemo, useState } from 'react'
import { type AddItemActions, requestItemClose, useAddItemActions } from '@/features/pod'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import { useActiveItemId, useActiveViewItems, usePodItem, useViewStore } from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { RiCloseLine, RiDeleteBinLine, RiEditLine } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import type { CommandItemConfig, PodItemConfig } from '@/types/schema'
import type { RunningTerminal } from '@/types/terminal'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { AddItemDropdown, AddItemMenuItems, EmptyAddItems } from './add-item-menu'
import { AgentBadge, ItemIcon, PodPill } from './item-chrome'
import { TabContent } from './tab-content'

const EMPTY_TERMINAL_CONFIG = { podTerminalId: '' } as const satisfies PodItemConfig

interface TabsViewProps {
  onNewCommand?: () => void
}

export function TabsView({ onNewCommand }: TabsViewProps) {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const viewItems = useActiveViewItems()
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const moveItem = useViewStore((s) => s.moveItem)

  const activeItemId = useActiveItemId()

  const placeItem = useCallback((item: { id: string }) => useViewStore.getState().splitPane('horizontal', item.id), [])

  const commandIdsInView = useMemo(
    () =>
      new Set(
        viewItems.filter((i) => i.contentType === 'command').map((i) => (i.config as CommandItemConfig).podCommandId),
      ),
    [viewItems],
  )

  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem,
    onItemsChanged: onTerminalsChanged,
    onNewCommand,
  })

  useViewShortcuts({
    onSplit: () => actions.addTerminal(),
    onClose: (info) => {
      requestItemClose(info.podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
    },
  })

  // Focus bridge: when activeItemId changes, select the running terminal
  useFocusBridge(activeItemId, runningTerminals)

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const sortableIds = useMemo(() => viewItems.map((i) => i.id), [viewItems])

  function handleDragStart(event: DragStartEvent) {
    setDraggedId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = viewItems.findIndex((i) => i.id === active.id)
    const newIndex = viewItems.findIndex((i) => i.id === over.id)
    if (oldIndex >= 0 && newIndex >= 0) {
      moveItem(oldIndex, newIndex)
    }
  }

  const draggedPodItem = usePodItem(draggedId)

  const activeViewItem = useMemo(() => {
    const item = viewItems.find((i) => i.id === activeItemId)
    return item ?? viewItems[0] ?? null
  }, [viewItems, activeItemId])

  if (viewItems.length === 0) {
    return <EmptyAddItems title="No tabs" actions={actions} />
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 flex flex-col min-h-0">
        {/* Tab bar */}
        <div
          role="tablist"
          aria-label="Terminal tabs"
          className="flex items-center h-8 border-b border-zinc-800 bg-zinc-950 shrink-0 overflow-x-auto"
        >
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            {viewItems.map((item, index) => {
              return (
                <SortableTab
                  key={item.id}
                  itemId={item.id}
                  index={index}
                  isActive={item.id === (activeViewItem?.id ?? null)}
                  runningTerminals={runningTerminals}
                  onTerminalRemoved={onTerminalRemoved}
                  onTerminalsChanged={onTerminalsChanged}
                  actions={actions}
                />
              )
            })}
          </SortableContext>

          {/* Add item button */}
          <AddItemDropdown
            actions={actions}
            showLabel={false}
            triggerClassName="flex items-center justify-center shrink-0 w-7 h-7 text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors rounded-md mx-0.5"
          />
        </div>

        {/* Tab content */}
        <div
          role="tabpanel"
          aria-labelledby={activeViewItem ? `tab-${activeViewItem.id}` : undefined}
          className="flex-1 min-h-0 bg-zinc-950"
        >
          {activeViewItem && (
            <TabContent item={activeViewItem} onTitleChange={autoRenamePodItem} onChanged={onTerminalsChanged} />
          )}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedPodItem && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-800 border border-zinc-600 shadow-lg">
            <ItemIcon
              contentType={draggedPodItem.contentType ?? 'terminal'}
              config={draggedPodItem.config}
              className="h-3.5 w-3.5 text-zinc-400"
            />
            <span className="text-xs text-zinc-200">{draggedPodItem.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

interface SortableTabProps {
  itemId: string
  index: number
  isActive: boolean
  runningTerminals: RunningTerminal[]
  onTerminalRemoved: (podTerminalId: string) => void
  onTerminalsChanged: () => void
  actions: AddItemActions
}

const SortableTab = memo(function SortableTab({
  itemId,
  index,
  isActive,
  runningTerminals,
  onTerminalRemoved,
  onTerminalsChanged,
  actions,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemId })
  const sortableAttributes = attributes as Omit<typeof attributes, 'role' | 'tabIndex'>
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const setActiveItem = useViewStore((s) => s.setActiveItem)
  const renamePodItem = useViewStore((s) => s.renamePodItem)
  const { isEditing, editValue, setEditValue, inputRef, startEditing, commitRename, cancelEditing } = useInlineEdit(
    (value) => renamePodItem(itemId, value),
  )
  const podItem = usePodItem(itemId)
  const label = podItem?.label ?? 'Unknown'
  const contentType = podItem?.contentType ?? 'terminal'
  const config = podItem?.config ?? EMPTY_TERMINAL_CONFIG
  const handleDelete = () => {
    if (!podItem) return
    requestItemClose(podItem, runningTerminals, {
      onTerminalRemoved,
      onItemsChanged: onTerminalsChanged,
    })
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled by dnd-kit
          <div
            ref={setNodeRef}
            style={style}
            id={`tab-${itemId}`}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`group flex items-center gap-1 h-full px-2 border-r border-zinc-800 cursor-pointer select-none shrink-0 ${
              isDragging ? 'opacity-40' : ''
            } ${isActive ? 'bg-zinc-900 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}
            onClick={() => setActiveItem(itemId)}
            onDoubleClick={() => startEditing(label)}
            {...listeners}
            {...sortableAttributes}
          />
        }
      >
        <PodPill podId={podItem?.podId} />
        <ItemIcon contentType={contentType} config={config} className="h-3 w-3 shrink-0 text-zinc-600" />

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
            className="bg-transparent border-none outline-none text-xs text-zinc-200 w-[80px] py-0"
          />
        ) : (
          <>
            <span className="text-xs truncate max-w-[120px]">{label}</span>
            {index >= 0 && index < 9 && (
              <span className="ml-0.5 shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
                &#8984;{index + 1}
              </span>
            )}
          </>
        )}

        <AgentBadge contentType={contentType} config={config} />
        {!isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleDelete()
            }}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100 ml-0.5"
            title="Close tab"
          >
            <RiCloseLine className="h-3.5 w-3.5" />
          </button>
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
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <RiDeleteBinLine />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
