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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { focusItem, requestItemClose, toViewItem, useAddItemActions } from '@/features/pod'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import {
  type PodItem,
  useActiveCarouselItems,
  useFocusedItemId,
  usePodItem,
  useViewStore,
} from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { RiCloseLine, RiDeleteBinLine, RiEditLine } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { useVirtualizedItems } from '@/shared/hooks/use-virtualized-items'
import { useFocusBorder } from '@/stores/appearance-store'
import type { CarouselItem, CommandItemConfig } from '@/types/schema'
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

export function CarouselView() {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const carouselItems = useActiveCarouselItems()
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const updateCarouselItems = useViewStore((s) => s.updateCarouselItems)
  const podItems = useViewStore((s) => {
    const entityId = s.activeEntityId
    return entityId ? (s.entities[entityId]?.podItems ?? EMPTY_POD_ITEMS) : EMPTY_POD_ITEMS
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const { visibleIds, registerItem } = useVirtualizedItems({ containerRef: scrollRef })

  const commandIdsInView = useMemo(() => {
    const visible = new Set(carouselItems.map((item) => item.itemId))
    return new Set(
      podItems
        .filter((pi) => pi.contentType === 'command' && visible.has(pi.id))
        .map((pi) => (pi.config as CommandItemConfig).podCommandId),
    )
  }, [carouselItems, podItems])

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

  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  useEffect(() => {
    if (!focusedItemId) return
    const el = panelRefs.current.get(focusedItemId)
    if (el) {
      el.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' })
    }
  }, [focusedItemId])

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const sortableIds = useMemo(() => carouselItems.map((i) => i.itemId), [carouselItems])

  function handleDragStart(event: DragStartEvent) {
    setDraggedId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = carouselItems.findIndex((i) => i.itemId === active.id)
    const newIndex = carouselItems.findIndex((i) => i.itemId === over.id)
    if (oldIndex >= 0 && newIndex >= 0) {
      updateCarouselItems(arrayMove(carouselItems, oldIndex, newIndex))
    }
  }

  const draggedPodItem = usePodItem(draggedId)

  if (carouselItems.length === 0) {
    return <EmptyAddItems title="No panels" actions={actions} />
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden flex gap-2 p-3">
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          {carouselItems.map((item, index) => (
            <CarouselPanel
              key={item.itemId}
              item={item}
              index={index}
              onTitleChange={autoRenamePodItem}
              totalPanels={carouselItems.length}
              visibleIds={visibleIds}
              registerItem={registerItem}
              panelRefs={panelRefs}
              scrollRef={scrollRef}
            />
          ))}
        </SortableContext>

        {/* Add item button */}
        <AddItemDropdown
          actions={actions}
          triggerClassName="flex items-center justify-center shrink-0 w-8 h-full rounded-md border border-dashed border-zinc-800 text-zinc-600 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
          contentClassName="w-48"
          contentAlign="center"
          contentSide="left"
          contentSideOffset={8}
          showLabel={false}
        />
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

interface CarouselPanelProps {
  item: CarouselItem
  index: number
  onTitleChange: (podTerminalId: string, title: string) => void
  totalPanels: number
  visibleIds: Set<string>
  registerItem: (itemId: string, el: HTMLElement | null) => void
  panelRefs: React.RefObject<Map<string, HTMLDivElement>>
  scrollRef: React.RefObject<HTMLDivElement | null>
}

const CarouselPanel = memo(function CarouselPanel({
  item,
  index,
  onTitleChange,
  totalPanels,
  visibleIds,
  registerItem,
  panelRefs,
  scrollRef,
}: CarouselPanelProps) {
  const { runningTerminals, onTerminalsChanged, onTerminalRemoved } = useTerminalRender()
  const focusedItemId = useFocusedItemId()
  const isFocused = focusedItemId === item.itemId
  const focusBorder = useFocusBorder()
  const focusPane = useViewStore((s) => s.focusPane)
  const renamePodItem = useViewStore((s) => s.renamePodItem)
  const resizeCarouselItem = useViewStore((s) => s.resizeCarouselItem)

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
      let baseDelta = 0
      let edgeDelta = 0
      let lastClientX = startX
      let rafId: number | null = null
      let stopped = false

      const target = e.currentTarget as HTMLElement
      const pointerId = e.pointerId
      target.setPointerCapture(pointerId)

      function applyWidth() {
        const newWidth = Math.max(300, startWidth + baseDelta + edgeDelta)
        resizeCarouselItem(item.itemId, newWidth)
      }

      function tickEdgeResize() {
        if (stopped) return

        const scroll = scrollRef.current
        if (!scroll) {
          rafId = null
          return
        }

        const rect = scroll.getBoundingClientRect()
        const edgeMargin = 28
        const overflow = lastClientX - (rect.right - edgeMargin)

        if (overflow <= 0) {
          rafId = null
          return
        }

        const step = Math.min(24, Math.max(3, overflow * 0.25))
        edgeDelta += step
        applyWidth()
        scroll.scrollLeft += step
        rafId = window.requestAnimationFrame(tickEdgeResize)
      }

      function ensureEdgeResize() {
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickEdgeResize)
        }
      }

      function onMove(ev: PointerEvent) {
        lastClientX = ev.clientX
        baseDelta = ev.clientX - startX
        applyWidth()

        // Auto-scroll: if the cursor passes (or nears) the right edge of the
        // scroll container — which happens when growing the rightmost panel
        // past the viewport — push scrollLeft to keep the resize handle in
        // view. If the pointer is pinned at the physical screen edge, keep
        // expanding on animation frames so the drag does not stall.
        const scroll = scrollRef.current
        if (!scroll) return
        const rect = scroll.getBoundingClientRect()
        const edgeMargin = 28
        const overflow = ev.clientX - (rect.right - edgeMargin)
        if (overflow > 0) {
          scroll.scrollLeft += overflow
          ensureEdgeResize()
        }
      }

      function onUp() {
        stopped = true
        if (rafId !== null) window.cancelAnimationFrame(rafId)
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
      }

      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
    },
    [item.width, item.itemId, resizeCarouselItem, scrollRef],
  )

  // Combined ref for virtualization + scroll-into-view + sortable
  const setPanelRef = useCallback(
    (el: HTMLDivElement | null) => {
      setSortableRef(el)
      registerItem(item.itemId, el)
      if (el) {
        panelRefs.current.set(item.itemId, el)
      } else {
        panelRefs.current.delete(item.itemId)
      }
    },
    [item.itemId, panelRefs, registerItem, setSortableRef],
  )

  return (
    <div
      ref={setPanelRef}
      style={{ width: item.width + 6, minWidth: 300, ...sortableStyle }}
      className={`flex shrink-0 h-full ${isDragging ? 'opacity-40' : ''}`}
      onMouseDown={handleFocus}
    >
      <div
        className={`flex flex-col h-full flex-1 min-w-0 rounded-md overflow-hidden border ${isFocused ? focusBorder : 'border-zinc-800'}`}
      >
        {/* Panel header — drag handle */}
        <ContextMenu>
          <ContextMenuTrigger
            render={
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
                {index >= 0 && index < 9 && (
                  <span className="ml-1.5 shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
                    &#8984;{index + 1}
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
                {totalPanels > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete()
                    }}
                    className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
                    title="Close panel"
                  >
                    <RiCloseLine className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => startEditing(label)}>
              <RiEditLine />
              Rename
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={() => handleDelete()}>
              <RiDeleteBinLine />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {/* Panel content */}
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
