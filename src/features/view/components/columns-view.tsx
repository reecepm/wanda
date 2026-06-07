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
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { focusItem, requestItemClose, toViewItem, useAddItemActions } from '@/features/pod'
import { useColumnsScroll } from '@/features/view/hooks/use-columns-scroll'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import {
  type PodItem,
  useActiveColumnsRows,
  useFocusedItemId,
  usePodItem,
  useViewStore,
} from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { RiAddLine, RiCloseLine, RiDeleteBinLine, RiEditLine } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { useVirtualizedItems } from '@/shared/hooks/use-virtualized-items'
import { useFocusBorder } from '@/stores/appearance-store'
import type { ColumnsRow, CommandItemConfig } from '@/types/schema'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { AddItemDropdown, EmptyAddItems } from './add-item-menu'
import { AgentBadge, ItemIcon, PodPill } from './item-chrome'
import { TabContent } from './tab-content'

const EMPTY_TERMINAL_CONFIG = { podTerminalId: '' } as const
const EMPTY_POD_ITEMS: PodItem[] = []

const PADDING = 12 // p-3

export function ColumnsView() {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const columnsRows = useActiveColumnsRows()
  const { scope } = useViewScope()
  const isWorkspaceScope = scope === 'workspace'
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const addColumnsRow = useViewStore((s) => s.addColumnsRow)
  const updateColumnsRows = useViewStore((s) => s.updateColumnsRows)
  const podItems = useViewStore((s) => {
    const entityId = s.activeEntityId
    return entityId ? (s.entities[entityId]?.podItems ?? EMPTY_POD_ITEMS) : EMPTY_POD_ITEMS
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const { visibleIds, registerItem } = useVirtualizedItems({ containerRef: scrollRef })
  useColumnsScroll(scrollRef)

  const [containerHeight, setContainerHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (scrollRef.current) {
      setContainerHeight(scrollRef.current.clientHeight)
    }
  }, [])
  useEffect(() => {
    if (!scrollRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [])

  const [scrollFade, setScrollFade] = useState({ top: false, bottom: false, left: false, right: false })
  const updateScrollFade = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setScrollFade({
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollFade()
    el.addEventListener('scroll', updateScrollFade, { passive: true })
    const observer = new ResizeObserver(updateScrollFade)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollFade)
      observer.disconnect()
    }
  }, [updateScrollFade])

  const commandIdsInView = useMemo(() => {
    const visible = new Set(columnsRows.flatMap((row) => row.items.map((item) => item.itemId)))
    return new Set(
      podItems
        .filter((pi) => pi.contentType === 'command' && visible.has(pi.id))
        .map((pi) => (pi.config as CommandItemConfig).podCommandId),
    )
  }, [columnsRows, podItems])

  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem: (item) => useViewStore.getState().splitPane('horizontal', item.id),
    onItemsChanged: onTerminalsChanged,
  })

  useViewShortcuts({
    onSplit: () => actions.addTerminal(),
    onClose: (info) => {
      requestItemClose(info.podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
    },
  })

  const focusedItemId = useFocusedItemId()
  useFocusBridge(focusedItemId, runningTerminals)

  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    if (!focusedItemId) return
    const el = itemRefs.current.get(focusedItemId)
    if (el) {
      el.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' })
    }
  }, [focusedItemId])

  // Each row is full container height minus top/bottom padding
  const rowHeight = containerHeight ? containerHeight - PADDING * 2 : 400

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart(event: DragStartEvent) {
    setDraggedId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const rows = structuredClone(columnsRows)
    let activeRowIdx = -1
    let activeItemIdx = -1
    let overRowIdx = -1
    let overItemIdx = -1

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      if (!row) continue
      for (let i = 0; i < row.items.length; i++) {
        const item = row.items[i]
        if (!item) continue
        if (item.itemId === active.id) {
          activeRowIdx = r
          activeItemIdx = i
        }
        if (item.itemId === over.id) {
          overRowIdx = r
          overItemIdx = i
        }
      }
    }

    if (activeRowIdx < 0 || overRowIdx < 0) return

    const activeRow = rows[activeRowIdx]
    const overRow = rows[overRowIdx]
    if (!activeRow || !overRow) return

    if (activeRowIdx === overRowIdx) {
      activeRow.items = arrayMove(activeRow.items, activeItemIdx, overItemIdx)
    } else if (isWorkspaceScope) {
      // At workspace scope, rows = pods — don't allow cross-row moves
      return
    } else {
      const [moved] = activeRow.items.splice(activeItemIdx, 1)
      if (!moved) return
      overRow.items.splice(overItemIdx, 0, moved)
    }

    updateColumnsRows(rows.filter((r) => r.items.length > 0))
  }

  const draggedPodItem = usePodItem(draggedId)
  const rowFlatIndexBases = useMemo(() => {
    return columnsRows.map((_, index) => columnsRows.slice(0, index).reduce((sum, row) => sum + row.items.length, 0))
  }, [columnsRows])

  if (columnsRows.length === 0 || columnsRows.every((r) => r.items.length === 0)) {
    return <EmptyAddItems title="No tiles" actions={actions} />
  }

  return (
    <div className="flex-1 min-h-0 relative">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={scrollRef}
          className="h-full overflow-auto p-3"
          style={{ scrollSnapType: 'both mandatory', scrollPadding: PADDING }}
        >
          {columnsRows.map((row, rowIndex) => (
            <ColumnsRowContainer
              // biome-ignore lint/suspicious/noArrayIndexKey: columns rows are positional layout containers without stable row ids.
              key={rowIndex}
              row={row}
              rowIndex={rowIndex}
              rowHeight={rowHeight}
              isLastRow={rowIndex === columnsRows.length - 1}
              flatIndexBase={rowFlatIndexBases[rowIndex] ?? 0}
              onTitleChange={autoRenamePodItem}
              totalRows={columnsRows.length}
              visibleIds={visibleIds}
              registerItem={registerItem}
              itemRefs={itemRefs}
              commandIdsInView={commandIdsInView}
            />
          ))}

          {/* Add row button — hidden at workspace scope where rows = pods */}
          {!isWorkspaceScope && (
            <div className="flex items-center justify-center py-2" style={{ scrollSnapAlign: 'end' }}>
              <button
                type="button"
                onClick={addColumnsRow}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <RiAddLine className="h-3.5 w-3.5" />
                Add Row
              </button>
            </div>
          )}
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

      {/* Scroll fade overlays — inset to avoid covering content at edges */}
      {scrollFade.top && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-zinc-950/60 to-transparent" />
      )}
      {scrollFade.bottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-zinc-950/60 to-transparent" />
      )}
      {scrollFade.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-zinc-950/60 to-transparent" />
      )}
      {scrollFade.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-zinc-950/60 to-transparent" />
      )}
    </div>
  )
}

interface ColumnsRowContainerProps {
  row: ColumnsRow
  rowIndex: number
  rowHeight: number
  isLastRow: boolean
  flatIndexBase: number
  onTitleChange: (podTerminalId: string, title: string) => void
  totalRows: number
  visibleIds: Set<string>
  registerItem: (itemId: string, el: HTMLElement | null) => void
  itemRefs: React.RefObject<Map<string, HTMLDivElement>>
  commandIdsInView: Set<string>
}

function ColumnsRowContainer({
  row,
  rowIndex,
  rowHeight,
  isLastRow,
  flatIndexBase,
  onTitleChange,
  totalRows,
  visibleIds,
  registerItem,
  itemRefs,
  commandIdsInView,
}: ColumnsRowContainerProps) {
  const sortableIds = useMemo(() => row.items.map((i) => i.itemId), [row.items])

  return (
    <div
      className="flex gap-2"
      style={{ height: rowHeight, scrollSnapAlign: 'start', marginBottom: isLastRow ? 0 : 8 }}
    >
      <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
        {row.items.map((item, itemIndex) => (
          <ColumnItem
            key={item.itemId}
            item={item}
            rowIndex={rowIndex}
            flatIndex={flatIndexBase + itemIndex}
            onTitleChange={onTitleChange}
            totalRows={totalRows}
            visibleIds={visibleIds}
            registerItem={registerItem}
            itemRefs={itemRefs}
          />
        ))}
      </SortableContext>

      <ColumnsRowAddItemMenu commandIdsInView={commandIdsInView} targetRowIndex={rowIndex} />
      {/* 1px spacer forces browser to respect scroll container's right padding */}
      <div className="shrink-0 w-1" />
    </div>
  )
}

function ColumnsRowAddItemMenu({
  commandIdsInView,
  targetRowIndex,
}: {
  commandIdsInView: Set<string>
  targetRowIndex: number
}) {
  const { podId, isRunning, terminalConfigs, commandConfigs, onTerminalsChanged } = useTerminalRender()
  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem: (item) => {
      const store = useViewStore.getState()
      store.splitPane('horizontal', item.id)
      if (targetRowIndex > 0) store.moveItemToRow(item.id, targetRowIndex)
    },
    onItemsChanged: onTerminalsChanged,
  })

  return (
    <AddItemDropdown
      actions={actions}
      showLabel={false}
      triggerClassName="flex items-center justify-center shrink-0 w-8 h-full rounded-md border border-dashed border-zinc-800 text-zinc-600 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
    />
  )
}

interface ColumnItemProps {
  item: { itemId: string; width: number }
  rowIndex: number
  flatIndex: number
  onTitleChange: (podTerminalId: string, title: string) => void
  totalRows: number
  visibleIds: Set<string>
  registerItem: (itemId: string, el: HTMLElement | null) => void
  itemRefs: React.RefObject<Map<string, HTMLDivElement>>
}

const ColumnItem = memo(function ColumnItem({
  item,
  rowIndex,
  flatIndex,
  onTitleChange,
  totalRows,
  visibleIds,
  registerItem,
  itemRefs,
}: ColumnItemProps) {
  const { runningTerminals, onTerminalsChanged, onTerminalRemoved } = useTerminalRender()
  const focusedItemId = useFocusedItemId()
  const isFocused = focusedItemId === item.itemId
  const focusBorder = useFocusBorder()
  const { scope: itemScope } = useViewScope()
  const isWorkspaceItem = itemScope === 'workspace'
  const focusPane = useViewStore((s) => s.focusPane)
  const renamePodItem = useViewStore((s) => s.renamePodItem)
  const resizeColumnsItem = useViewStore((s) => s.resizeColumnsItem)
  const moveItemToRow = useViewStore((s) => s.moveItemToRow)

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.itemId })
  const sortableStyle = {
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
  }

  const podItem = usePodItem(item.itemId)
  const label = podItem?.label ?? 'Unknown'

  const viewItem = podItem ? toViewItem(podItem) : null

  const { isEditing, editValue, setEditValue, inputRef, startEditing, commitRename, cancelEditing } = useInlineEdit(
    (value) => renamePodItem(item.itemId, value),
  )
  function handleFocus() {
    focusPane(item.itemId)
    if (podItem) focusItem(podItem, runningTerminals)
  }

  function handleDelete() {
    if (!podItem) return
    requestItemClose(podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
  }

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidth = item.width

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)

      function onMove(ev: PointerEvent) {
        const delta = ev.clientX - startX
        const newWidth = Math.max(300, startWidth + delta)
        resizeColumnsItem(rowIndex, item.itemId, newWidth)
      }

      function onUp() {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
      }

      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
    },
    [item.width, item.itemId, rowIndex, resizeColumnsItem],
  )

  // Combined ref for virtualization + scroll-into-view + sortable
  const setItemRef = useCallback(
    (el: HTMLDivElement | null) => {
      setSortableRef(el)
      registerItem(item.itemId, el)
      if (el) {
        itemRefs.current.set(item.itemId, el)
      } else {
        itemRefs.current.delete(item.itemId)
      }
    },
    [item.itemId, itemRefs, registerItem, setSortableRef],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer down selects/focuses the draggable tile shell.
    <div
      ref={setItemRef}
      style={{ width: item.width + 6, minWidth: 300, scrollSnapAlign: 'start', ...sortableStyle }}
      className={`flex shrink-0 h-full ${isDragging ? 'opacity-40' : ''}`}
      onMouseDown={handleFocus}
    >
      <div
        className={`flex flex-col h-full flex-1 min-w-0 rounded-md overflow-hidden border ${isFocused ? focusBorder : 'border-zinc-800'}`}
        data-focused={isFocused || undefined}
      >
        {/* Item header — drag handle */}
        <ContextMenu>
          <ContextMenuTrigger
            render={
              // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit injects drag handle listeners and attributes here.
              <div
                className={`group flex items-center h-8 px-2 border-b shrink-0 cursor-grab active:cursor-grabbing ${isFocused ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950 border-zinc-800'}`}
                onDoubleClick={() => startEditing(label)}
                {...listeners}
                {...attributes}
              />
            }
          >
            <PodPill podId={podItem?.podId} />
            <ItemIcon
              contentType={podItem?.contentType ?? 'terminal'}
              config={podItem?.config}
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
                className="bg-transparent border-none outline-none text-xs text-zinc-200 w-[100px] py-0"
              />
            ) : (
              <>
                <span className="text-xs text-zinc-400 truncate min-w-0">{label}</span>
                {flatIndex >= 0 && flatIndex < 9 && (
                  <span className="ml-1.5 shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
                    &#8984;{flatIndex + 1}
                  </span>
                )}
              </>
            )}

            <div className="flex-1" />
            <AgentBadge
              contentType={podItem?.contentType ?? 'terminal'}
              config={podItem?.config ?? EMPTY_TERMINAL_CONFIG}
            />

            {!isEditing && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete()
                  }}
                  className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                  title="Close tile"
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
            {!isWorkspaceItem &&
              totalRows > 1 &&
              Array.from({ length: totalRows }, (_, i) => i)
                .filter((i) => i !== rowIndex)
                .map((targetRow) => (
                  <ContextMenuItem key={targetRow} onClick={() => moveItemToRow(item.itemId, targetRow)}>
                    Move to Row {targetRow + 1}
                  </ContextMenuItem>
                ))}
            {!isWorkspaceItem && (
              <ContextMenuItem onClick={() => moveItemToRow(item.itemId, totalRows)}>Move to New Row</ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => handleDelete()}>
              <RiDeleteBinLine />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Item content */}
        <div className="flex-1 min-h-0 bg-zinc-950">
          {visibleIds.has(item.itemId) && viewItem ? (
            <TabContent item={viewItem} onTitleChange={onTitleChange} onChanged={onTerminalsChanged} />
          ) : (
            <div className="h-full bg-zinc-950" />
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="w-1.5 shrink-0 cursor-col-resize hover:bg-zinc-600 active:bg-zinc-500 transition-colors rounded-full"
        onPointerDown={onResizePointerDown}
      />
    </div>
  )
})
