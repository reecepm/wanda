import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactGridLayout, {
  type LegacyReactGridLayoutProps,
  type LayoutItem as RGLLayoutItem,
} from 'react-grid-layout/legacy'
import { RiCloseLine, RiDeleteBinLine, RiEditLine } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { AgentBadge, ItemIcon, PodPill } from './item-chrome'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { useAddItemActions } from '@/features/pod/utils/add-item-actions'
import { focusItem, requestItemClose } from '@/features/pod/utils/item-utils'
import { toViewItem } from '@/features/pod/utils/terminal-utils'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import {
  type PodItem,
  useActiveGridWidgets,
  useFocusedItemId,
  usePodItem,
  useViewStore,
} from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import { useFocusBorder } from '@/stores/appearance-store'
import type { CommandItemConfig, GridWidget } from '@/types/schema'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { EmptyAddItems } from './add-item-menu'
import { TabContent } from './tab-content'

const EMPTY_TERMINAL_CONFIG = { podTerminalId: '' } as const
const EMPTY_POD_ITEMS: PodItem[] = []

export function GridView() {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const widgets = useActiveGridWidgets()
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const updateGridLayout = useViewStore((s) => s.updateGridLayout)
  const podItems = useViewStore((s) => {
    const entityId = s.activeEntityId
    return entityId ? (s.entities[entityId]?.podItems ?? EMPTY_POD_ITEMS) : EMPTY_POD_ITEMS
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  // Measure synchronously before first paint to avoid layout shift
  useLayoutEffect(() => {
    if (containerRef.current) {
      setContainerWidth(containerRef.current.clientWidth)
    }
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const commandIdsInView = useMemo(() => {
    const visible = new Set(widgets.map((widget) => widget.itemId))
    return new Set(
      podItems
        .filter((pi) => pi.contentType === 'command' && visible.has(pi.id))
        .map((pi) => (pi.config as CommandItemConfig).podCommandId),
    )
  }, [widgets, podItems])

  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem: (item) => useViewStore.getState().splitPane('horizontal', item.id),
    onItemsChanged: onTerminalsChanged,
  })

  // Register split/close callbacks for keyboard shortcuts (both directions just add a widget)
  useViewShortcuts({
    onSplit: () => actions.addTerminal(),
    onClose: (info) => {
      requestItemClose(info.podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
    },
  })

  // Focus bridge: sync on view switch or focus change
  const focusedItemId = useFocusedItemId()
  useFocusBridge(focusedItemId, runningTerminals)

  const handleLayoutChange = useCallback(
    (layout: readonly RGLLayoutItem[]) => {
      const newWidgets: GridWidget[] = layout
        .map((l) => {
          const existing = widgets.find((w) => w.itemId === l.i)
          if (!existing) return null
          return { itemId: l.i, x: l.x, y: l.y, w: l.w, h: l.h }
        })
        .filter((w): w is GridWidget => w !== null)
      updateGridLayout(newWidgets)
    },
    [widgets, updateGridLayout],
  )

  if (widgets.length === 0) {
    return <EmptyAddItems title="No widgets" actions={actions} />
  }

  const rglLayout = widgets.map((w) => ({
    i: w.itemId,
    x: w.x,
    y: w.y,
    w: w.w,
    h: w.h,
    minW: 2,
    minH: 2,
  }))
  const gridLayoutProps = {
    className: 'layout',
    layout: rglLayout,
    cols: 12,
    rowHeight: 50,
    width: containerWidth ?? 0,
    draggableHandle: '.widget-header',
    onLayoutChange: handleLayoutChange,
    compactType: 'vertical',
    margin: [4, 4],
  } satisfies Omit<LegacyReactGridLayoutProps, 'children'>

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-auto">
      {containerWidth !== null && (
        <ReactGridLayout {...gridLayoutProps}>
          {widgets.map((widget, widgetIndex) => (
            <div key={widget.itemId}>
              <GridWidgetChrome itemId={widget.itemId} widgetIndex={widgetIndex} onTitleChange={autoRenamePodItem} />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}

interface GridWidgetChromeProps {
  itemId: string
  widgetIndex: number
  onTitleChange: (podTerminalId: string, title: string) => void
}

const GridWidgetChrome = memo(function GridWidgetChrome({ itemId, widgetIndex, onTitleChange }: GridWidgetChromeProps) {
  const { runningTerminals, onTerminalsChanged, onTerminalRemoved } = useTerminalRender()
  const focusedItemId = useFocusedItemId()
  const isFocused = focusedItemId === itemId
  const focusBorder = useFocusBorder()
  const focusPane = useViewStore((s) => s.focusPane)
  const renamePodItem = useViewStore((s) => s.renamePodItem)

  const podItem = usePodItem(itemId)
  const label = podItem?.label ?? 'Unknown'

  const viewItem = podItem ? toViewItem(podItem) : null

  const { isEditing, editValue, setEditValue, inputRef, startEditing, commitRename, cancelEditing } = useInlineEdit(
    (value) => renamePodItem(itemId, value),
  )

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
      className={`flex flex-col h-full rounded-md overflow-hidden border ${isFocused ? focusBorder : 'border-zinc-800'}`}
      onMouseDown={handleFocus}
    >
      {/* Widget header — drag handle */}
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className={`widget-header group flex items-center h-8 px-2 border-b shrink-0 cursor-grab active:cursor-grabbing ${isFocused ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950 border-zinc-800'}`}
              onDoubleClick={() => startEditing(label)}
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
              {widgetIndex >= 0 && widgetIndex < 9 && (
                <span className="ml-1.5 shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
                  &#8984;{widgetIndex + 1}
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
          <ContextMenuItem variant="destructive" onClick={() => handleDelete()}>
            <RiDeleteBinLine />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Widget content */}
      <div className="flex-1 min-h-0 bg-zinc-950">
        {viewItem ? (
          <TabContent item={viewItem} onTitleChange={onTitleChange} onChanged={onTerminalsChanged} />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-xs">Item not found</div>
        )}
      </div>
    </div>
  )
})
