import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { memo, type RefObject, useCallback, useMemo, useState } from 'react'
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels'
import { createTerminal, focusItem, requestItemClose, toViewItem, useAddItemActions } from '@/features/pod'
import { useFocusBridge } from '@/features/view/hooks/use-focus-bridge'
import { useViewShortcuts } from '@/features/view/hooks/use-view-shortcuts'
import {
  type PodItem,
  useActivePaneIndex,
  useActivePaneTabGroup,
  useActiveViewId,
  useActiveViewLayout,
  useFocusedItemId,
  usePodItem,
  useViewStore,
} from '@/features/view/store/view-store'
import { useTerminalRender } from '@/features/view/terminal-render-context'
import type { SplitNode } from '@/features/view/utils/split-tree'
import { collectLeafIds, countLeaves } from '@/features/view/utils/split-tree'
import { RiCloseLine, RiDeleteBinLine, RiEditLine, RiSplitCellsHorizontal, RiSplitCellsVertical } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { useFocusBorder } from '@/stores/appearance-store'
import type { CommandItemConfig } from '@/types/schema'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { AddItemDropdown, EmptyAddItems } from './add-item-menu'
import { AgentBadge, ItemIcon, PodPill } from './item-chrome'
import { TabContent } from './tab-content'

const EMPTY_TERMINAL_CONFIG = { podTerminalId: '' } as const
const EMPTY_POD_ITEMS: PodItem[] = []

export function SplitPaneView() {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const activeViewId = useActiveViewId()
  const layout = useActiveViewLayout()
  const focusedItemId = useFocusedItemId()
  const autoRenamePodItem = useViewStore((s) => s.autoRenamePodItem)
  const podItems = useViewStore((s) => {
    const entityId = s.activeEntityId
    return entityId ? (s.entities[entityId]?.podItems ?? EMPTY_POD_ITEMS) : EMPTY_POD_ITEMS
  })

  const commandIdsInView = useMemo(() => {
    const visible = layout ? new Set(collectLeafIds(layout)) : new Set<string>()
    return new Set(
      podItems
        .filter((pi) => pi.contentType === 'command' && visible.has(pi.id))
        .map((pi) => (pi.config as CommandItemConfig).podCommandId),
    )
  }, [layout, podItems])

  const actions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView,
    placeItem: (item) => useViewStore.getState().splitPane('horizontal', item.id),
    onItemsChanged: onTerminalsChanged,
  })

  async function createAndSplit(direction: 'horizontal' | 'vertical') {
    const newPodItem = await createTerminal(podId, { isRunning, count: terminalConfigs.length })
    if (newPodItem) {
      useViewStore.getState().splitPane(direction, newPodItem.id)
    }
    onTerminalsChanged()
  }

  useViewShortcuts({
    onSplit: (direction) => createAndSplit(direction),
    onClose: (info) => {
      requestItemClose(info.podItem, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
    },
  })

  // Focus bridge: when focusedItemId or active view changes, sync useUIStore.selectedId
  useFocusBridge(focusedItemId, runningTerminals)

  const swapPanes = useViewStore((s) => s.swapPanes)
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function handleDragStart(event: DragStartEvent) {
    setDraggedItemId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedItemId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      swapPanes(active.id as string, over.id as string)
    }
  }

  const draggedPodItem = usePodItem(draggedItemId)

  if (!layout) {
    return <EmptyAddItems title="No panes" actions={actions} />
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div key={activeViewId ?? ''} className="flex-1 min-h-0">
        <PaneLayout node={layout} path={[]} onTitleChange={autoRenamePodItem} totalLeaves={countLeaves(layout)} />
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

interface PaneLayoutProps {
  node: SplitNode
  path: number[]
  onTitleChange: (podTerminalId: string, title: string) => void
  totalLeaves: number
}

function PaneLayout({ node, path, onTitleChange, totalLeaves }: PaneLayoutProps) {
  if (node.type === 'leaf') {
    return <PaneChrome itemId={node.itemId} onTitleChange={onTitleChange} totalLeaves={totalLeaves} />
  }

  return <PaneBranch node={node} path={path} onTitleChange={onTitleChange} totalLeaves={totalLeaves} />
}

/** Separate component for branch nodes so hooks are always called consistently. */
function PaneBranch({
  node,
  path,
  onTitleChange,
  totalLeaves,
}: PaneLayoutProps & { node: Extract<SplitNode, { type: 'branch' }> }) {
  const updatePaneSizes = useViewStore((s) => s.updatePaneSizes)
  const pathKey = path.join(',')
  const panelIdA = `p-${pathKey}-0`
  const panelIdB = `p-${pathKey}-1`

  const handleLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      const a = layout[panelIdA]
      const b = layout[panelIdB]
      if (a !== undefined && b !== undefined) {
        updatePaneSizes(path, [a, b])
      }
    },
    [panelIdA, panelIdB, path, updatePaneSizes],
  )

  return (
    <PanelGroup orientation={node.direction} onLayoutChanged={handleLayoutChanged} className="h-full">
      <Panel id={panelIdA} defaultSize={`${node.sizes[0]}%`} minSize="10%">
        <PaneLayout
          node={node.children[0]}
          path={[...path, 0]}
          onTitleChange={onTitleChange}
          totalLeaves={totalLeaves}
        />
      </Panel>
      <PanelResizeHandle
        className={`
        ${node.direction === 'horizontal' ? 'w-px' : 'h-px'}
        bg-zinc-800 hover:bg-zinc-600 active:bg-zinc-500 transition-colors
        data-[separator-active]:bg-zinc-500
      `}
      />
      <Panel id={panelIdB} defaultSize={`${node.sizes[1]}%`} minSize="10%">
        <PaneLayout
          node={node.children[1]}
          path={[...path, 1]}
          onTitleChange={onTitleChange}
          totalLeaves={totalLeaves}
        />
      </Panel>
    </PanelGroup>
  )
}

interface PaneChromeProps {
  itemId: string // This is the pane leaf ID (key into paneTabs)
  onTitleChange: (podTerminalId: string, title: string) => void
  totalLeaves: number
}

const PaneChrome = memo(function PaneChrome({ itemId: paneId, onTitleChange, totalLeaves }: PaneChromeProps) {
  const { podId, isRunning, terminalConfigs, commandConfigs, runningTerminals, onTerminalsChanged, onTerminalRemoved } =
    useTerminalRender()
  const focusedItemId = useFocusedItemId()
  const focusBorder = useFocusBorder()
  const focusPaneFn = useViewStore((s) => s.focusPane)
  const splitPane = useViewStore((s) => s.splitPane)
  const renamePodItem = useViewStore((s) => s.renamePodItem)
  const addTabToPane = useViewStore((s) => s.addTabToPane)
  const setActiveTabInPane = useViewStore((s) => s.setActiveTabInPane)
  const podItems = useViewStore((s) => {
    const entityId = s.activeEntityId
    return entityId ? (s.entities[entityId]?.podItems ?? EMPTY_POD_ITEMS) : EMPTY_POD_ITEMS
  })

  const paneGroup = useActivePaneTabGroup(paneId)
  const fallbackTabIds = useMemo(() => [paneId], [paneId])
  const tabIds = paneGroup?.tabIds ?? fallbackTabIds
  const activeTabId = paneGroup?.activeTabId ?? tabIds[0] ?? null
  const commandIdsInPane = useMemo(() => {
    const visible = new Set(tabIds)
    return new Set(
      podItems
        .filter((pi) => pi.contentType === 'command' && visible.has(pi.id))
        .map((pi) => (pi.config as CommandItemConfig).podCommandId),
    )
  }, [tabIds, podItems])
  const tabActions = useAddItemActions({
    podId,
    isRunning,
    terminalCount: terminalConfigs.length,
    commandConfigs,
    commandIdsInView: commandIdsInPane,
    placeItem: (item) => addTabToPane(paneId, item.id),
    onItemsChanged: onTerminalsChanged,
  })

  // Is this pane focused? (any of its tabs is the focusedItemId)
  const isFocused = focusedItemId !== null && tabIds.includes(focusedItemId)

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: paneId })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: paneId })

  const paneIndex = useActivePaneIndex(paneId)

  const activePodItem = usePodItem(activeTabId) ?? null
  const activeViewItem = activePodItem ? toViewItem(activePodItem) : null

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const {
    editValue,
    setEditValue,
    inputRef: editInputRef,
    startEditing: startEdit,
    commitRename: commitEdit,
    cancelEditing: cancelEdit,
  } = useInlineEdit((value) => {
    if (editingTabId) renamePodItem(editingTabId, value)
  })

  function startEditingTab(tabItemId: string) {
    setEditingTabId(tabItemId)
    startEdit(getPodItemFromStore(tabItemId)?.label ?? '')
  }

  function commitRename() {
    commitEdit()
    setEditingTabId(null)
  }

  function handlePaneFocus(tabItemId?: string) {
    const targetId = tabItemId ?? activeTabId
    if (targetId) {
      focusPaneFn(targetId)
      const pi = getPodItemFromStore(targetId)
      if (pi) focusItem(pi, runningTerminals)
    }
  }

  function handleSelectTab(tabItemId: string) {
    setActiveTabInPane(paneId, tabItemId)
    handlePaneFocus(tabItemId)
  }

  async function handleSplit(direction: 'horizontal' | 'vertical') {
    const newPodItem = await createTerminal(podId, { isRunning, count: terminalConfigs.length })
    if (newPodItem) {
      splitPane(direction, newPodItem.id)
    }
    onTerminalsChanged()
  }

  function handleDelete(tabItemId: string) {
    const pi = getPodItemFromStore(tabItemId)
    if (!pi) return
    requestItemClose(pi, runningTerminals, { onTerminalRemoved, onItemsChanged: onTerminalsChanged })
  }

  return (
    <div
      ref={setDropRef}
      className={`
        flex flex-col h-full border
        ${isFocused ? focusBorder : 'border-transparent'}
        ${isOver && !isDragging ? 'ring-2 ring-blue-500/50 ring-inset' : ''}
        ${isDragging ? 'opacity-40' : ''}
      `}
      onMouseDown={() => handlePaneFocus()}
    >
      {/* Pane header: tab bar + actions */}
      <div
        className={`group flex items-center h-8 border-b shrink-0 ${isFocused ? 'bg-zinc-900 border-zinc-700' : 'bg-zinc-950 border-zinc-800'}`}
      >
        {/* Drag handle + pane index */}
        <div
          ref={setDragRef}
          className="flex items-center shrink-0 px-1.5 h-full cursor-grab active:cursor-grabbing"
          {...listeners}
          {...attributes}
        >
          {paneIndex >= 0 && paneIndex < 9 && (
            <span className="shrink-0 text-[10px] text-zinc-600 bg-zinc-800 rounded-md px-1 tabular-nums leading-4">
              &#8963;{paneIndex + 1}
            </span>
          )}
        </div>

        {/* Tab bar */}
        <div role="tablist" aria-label="Pane tabs" className="flex items-center min-w-0 overflow-x-auto h-full">
          {tabIds.map((tabItemId) => (
            <PaneTab
              key={tabItemId}
              tabItemId={tabItemId}
              activeTabId={activeTabId}
              editingTabId={editingTabId}
              editValue={editValue}
              setEditValue={setEditValue}
              editInputRef={editInputRef}
              onCommitRename={commitRename}
              onCancelRename={() => {
                cancelEdit()
                setEditingTabId(null)
              }}
              onStartEditing={startEditingTab}
              onSelectTab={handleSelectTab}
              onDeleteTab={handleDelete}
              onSplit={handleSplit}
              showCloseButton={tabIds.length > 1}
            />
          ))}

          {/* Add tab button */}
          <AddItemDropdown
            actions={tabActions}
            showLabel={false}
            triggerClassName="flex items-center justify-center shrink-0 w-6 h-full text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/30 transition-colors"
          />
        </div>

        <div className="flex-1" />
        <AgentBadge
          contentType={activePodItem?.contentType ?? 'terminal'}
          config={activePodItem?.config ?? EMPTY_TERMINAL_CONFIG}
        />

        {/* Split + close pane buttons */}
        <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleSplit('horizontal')
            }}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Split right"
          >
            <RiSplitCellsHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleSplit('vertical')
            }}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Split down"
          >
            <RiSplitCellsVertical className="h-3.5 w-3.5" />
          </button>
          {totalLeaves > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                // Close active tab (which may close the pane)
                if (activeTabId) handleDelete(activeTabId)
              }}
              className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Close pane"
            >
              <RiCloseLine className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Pane content — active tab */}
      <div
        role="tabpanel"
        aria-labelledby={activeTabId ? `pane-tab-${activeTabId}` : undefined}
        className="flex-1 min-h-0"
      >
        {activeViewItem ? (
          <TabContent item={activeViewItem} onTitleChange={onTitleChange} onChanged={onTerminalsChanged} />
        ) : (
          <div className="h-full flex items-center justify-center text-zinc-600 text-xs">No terminal selected</div>
        )}
      </div>
    </div>
  )
})

function getPodItemFromStore(itemId: string | null): PodItem | undefined {
  if (!itemId) return undefined
  const state = useViewStore.getState()
  const pod = state.activeEntityId ? state.entities[state.activeEntityId] : undefined
  return pod?.podItems.find((item) => item.id === itemId)
}

interface PaneTabProps {
  tabItemId: string
  activeTabId: string | null
  editingTabId: string | null
  editValue: string
  setEditValue: (value: string) => void
  editInputRef: RefObject<HTMLInputElement | null>
  onCommitRename: () => void
  onCancelRename: () => void
  onStartEditing: (tabItemId: string) => void
  onSelectTab: (tabItemId: string) => void
  onDeleteTab: (tabItemId: string) => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
  showCloseButton: boolean
}

const PaneTab = memo(function PaneTab({
  tabItemId,
  activeTabId,
  editingTabId,
  editValue,
  setEditValue,
  editInputRef,
  onCommitRename,
  onCancelRename,
  onStartEditing,
  onSelectTab,
  onDeleteTab,
  onSplit,
  showCloseButton,
}: PaneTabProps) {
  const podItem = usePodItem(tabItemId)
  const tabLabel = podItem?.label ?? 'Unknown'
  const isActive = tabItemId === activeTabId
  const isEditingThis = editingTabId === tabItemId

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          // biome-ignore lint/a11y/useKeyWithClickEvents: tab click
          <div
            id={`pane-tab-${tabItemId}`}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`flex items-center gap-1 h-full px-2 border-r border-zinc-800/50 cursor-pointer select-none shrink-0 ${
              isActive ? 'text-zinc-200 bg-zinc-800/40' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/20'
            }`}
            onClick={() => onSelectTab(tabItemId)}
            onDoubleClick={() => onStartEditing(tabItemId)}
          />
        }
      >
        <PodPill podId={podItem?.podId} />
        <ItemIcon
          contentType={podItem?.contentType ?? 'terminal'}
          config={podItem?.config}
          className="h-3 w-3 shrink-0 text-zinc-600"
        />
        {isEditingThis ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              if (e.key === 'Escape') onCancelRename()
              e.stopPropagation()
            }}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent border-none outline-none text-xs text-zinc-200 w-[80px] py-0"
          />
        ) : (
          <span className="text-xs truncate max-w-[100px]">{tabLabel}</span>
        )}
        {showCloseButton && !isEditingThis && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteTab(tabItemId)
            }}
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
            title="Close tab"
          >
            <RiCloseLine className="h-3.5 w-3.5" />
          </button>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onStartEditing(tabItemId)}>
          <RiEditLine />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onSplit('horizontal')}>
          <RiSplitCellsHorizontal />
          Split Right
          <ContextMenuShortcut>&#8984;D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onSplit('vertical')}>
          <RiSplitCellsVertical />
          Split Down
          <ContextMenuShortcut>&#8984;&#8679;D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onDeleteTab(tabItemId)}>
          <RiDeleteBinLine />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
