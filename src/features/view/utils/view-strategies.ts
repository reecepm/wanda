import {
  collectLeafIds,
  findLeaf,
  findPaneForItem,
  leafAtIndex,
  nextLeaf,
  prevLeaf,
  removeLeaf,
  type SplitNode,
  splitLeaf,
} from '@/features/view/utils/split-tree'
import type {
  CanvasNode,
  CanvasViewport,
  CarouselItem,
  ColumnsRow,
  GridWidget,
  PaneTabGroup,
  PodItemConfig,
  ViewItemSettings,
} from '@/types/schema'

export interface PodItem {
  id: string
  podId?: string
  contentType: 'terminal' | 'browser' | 'agent' | 'agent-session' | 'command' | 'markdown'
  label: string
  labelSource: string
  config: PodItemConfig
  sortOrder: number
}

export interface ViewItem {
  id: string
  podId?: string
  contentType: 'terminal' | 'browser' | 'agent' | 'agent-session' | 'command' | 'markdown'
  label: string
  labelSource: 'default' | 'terminal' | 'user'
  config: PodItemConfig
  sortOrder: number
  pinned?: boolean
}

function carouselItemIds(items: CarouselItem[]): string[] {
  return items.map((i) => i.itemId)
}

function columnsItemIds(rows: ColumnsRow[]): string[] {
  return rows.flatMap((r) => r.items.map((i) => i.itemId))
}

function canvasNodeItemIds(nodes: CanvasNode[]): string[] {
  return nodes.map((n) => n.itemId)
}

/** Collect all pod item IDs across all pane tab groups. */
function paneTabItemIds(paneTabs: Record<string, PaneTabGroup>): string[] {
  const ids: string[] = []
  for (const group of Object.values(paneTabs)) {
    ids.push(...group.tabIds)
  }
  return ids
}

/** Build paneTabs from a layout tree where each leaf has exactly one tab. */
function buildPaneTabsFromLayout(layout: SplitNode): Record<string, PaneTabGroup> {
  const tabs: Record<string, PaneTabGroup> = {}
  for (const leafId of collectLeafIds(layout)) {
    tabs[leafId] = { tabIds: [leafId], activeTabId: leafId }
  }
  return tabs
}

/** Find a free position for a new canvas node near the centroid of existing nodes. */
function findFreeCanvasPosition(existing: CanvasNode[]): { x: number; y: number } {
  const w = 600
  const h = 420
  const overlap = 40

  if (existing.length === 0) return { x: 0, y: 0 }

  const cx = existing.reduce((s, n) => s + n.x + n.width / 2, 0) / existing.length
  const cy = existing.reduce((s, n) => s + n.y + n.height / 2, 0) / existing.length

  const ox = Math.round((cx - w / 2) / 20) * 20
  const oy = Math.round((cy - h / 2) / 20) * 20

  const stepX = w - overlap
  const stepY = h - overlap

  function collides(x: number, y: number): boolean {
    return existing.some(
      (n) =>
        x < n.x + n.width - overlap && x + w > n.x + overlap && y < n.y + n.height - overlap && y + h > n.y + overlap,
    )
  }

  for (let ring = 0; ring <= 10; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue
        const x = ox + dx * stepX
        const y = oy + dy * stepY
        if (!collides(x, y)) return { x, y }
      }
    }
  }

  const maxY = existing.reduce((m, n) => Math.max(m, n.y + n.height), 0)
  return { x: ox, y: Math.round((maxY + overlap) / 20) * 20 }
}

export interface PerViewState {
  id: string
  name: string
  viewType: ViewType
  itemSettings: Record<string, ViewItemSettings>
  activeItemId: string | null
  focusedItemId: string | null
  layout: SplitNode | null
  paneTabs: Record<string, PaneTabGroup> | null
  gridWidgets: GridWidget[] | null
  carouselItems: CarouselItem[] | null
  columnsRows: ColumnsRow[] | null
  canvasNodes: CanvasNode[] | null
  canvasViewport: CanvasViewport | null
}

export type ViewType = 'tabs' | 'split-pane' | 'grid' | 'carousel' | 'columns' | 'canvas'

export interface ViewTypeStrategy {
  /** Get ordered list of visible item IDs */
  getItemIds(state: PerViewState): string[]

  /** Check whether an item exists in this view */
  containsItem(state: PerViewState, itemId: string, podItems: PodItem[]): boolean

  /** Add an item to the view. Returns updated view-type-specific fields. */
  addItem(state: PerViewState, itemId: string): Partial<PerViewState>

  /** Remove an item from the view. Returns updated view-type-specific fields + new focus. */
  removeItem(
    state: PerViewState,
    itemId: string,
    podItems: PodItem[],
  ): Partial<PerViewState> & { newFocusedItemId: string | null }

  /** Get the next item ID for focus navigation (non-wrapping). */
  getNextItemId(state: PerViewState, currentId: string): string | null

  /** Get the previous item ID for focus navigation (non-wrapping). */
  getPrevItemId(state: PerViewState, currentId: string): string | null

  /** Get item ID at the given index. */
  getItemIdAtIndex(state: PerViewState, index: number): string | null

  /** Build view items from pod items. */
  buildViewItems(state: PerViewState, podItems: PodItem[]): ViewItem[]

  /** Create initial PerViewState fields for this view type from pod items. */
  createInitialState(podItems: PodItem[], itemSettings: Record<string, ViewItemSettings>): Partial<PerViewState>

  /** Build the config object for persistence. */
  buildConfig(state: PerViewState): Record<string, unknown> | null

  /**
   * Handle "splitPane" for the ACTIVE view — add a new item, possibly creating a new
   * pane/widget/node. Returns updated view-type-specific fields.
   */
  addItemToActiveView(
    state: PerViewState,
    newItemId: string,
    direction: 'horizontal' | 'vertical',
  ): Partial<PerViewState>

  /**
   * Handle "splitPane" for a NON-ACTIVE view — ensure the item exists.
   * Returns updated view-type-specific fields.
   */
  addItemToOtherView(state: PerViewState, newItemId: string): Partial<PerViewState>

  /**
   * Reconcile after items change externally — remove deleted items, fix focus.
   * Returns updated view-type-specific fields.
   */
  reconcile(state: PerViewState, validIds: Set<string>): Partial<PerViewState> & { newFocusedItemId: string | null }
}

function podItemToViewItem(pi: PodItem, settings?: ViewItemSettings): ViewItem {
  return {
    id: pi.id,
    podId: pi.podId,
    contentType: pi.contentType,
    label: pi.label,
    labelSource: pi.labelSource as 'default' | 'terminal' | 'user',
    config: pi.config,
    sortOrder: settings?.sortOrder ?? pi.sortOrder,
    pinned: settings?.pinned,
  }
}

function podItemsToViewItemsByIds(
  podItems: PodItem[],
  ids: Set<string>,
  itemSettings: Record<string, ViewItemSettings>,
): ViewItem[] {
  return podItems.filter((pi) => ids.has(pi.id)).map((pi) => podItemToViewItem(pi, itemSettings[pi.id]))
}

function linearNext(ids: string[], currentId: string): string | null {
  const idx = ids.indexOf(currentId)
  return idx >= 0 && idx < ids.length - 1 ? (ids[idx + 1] ?? null) : null
}

function linearPrev(ids: string[], currentId: string): string | null {
  const idx = ids.indexOf(currentId)
  return idx > 0 ? (ids[idx - 1] ?? null) : null
}

const tabsStrategy: ViewTypeStrategy = {
  getItemIds(_state) {
    // Tabs don't have an explicit item list — all pod items are shown
    // Caller must pass podItems via buildViewItems for a full list
    return []
  },

  containsItem(state, itemId, podItems) {
    const items = this.buildViewItems(state, podItems)
    return items.some((i) => i.id === itemId)
  },

  addItem(state, itemId) {
    const newSettings = { ...state.itemSettings }
    const existing = newSettings[itemId]
    if (existing) {
      newSettings[itemId] =
        existing.sortOrder !== undefined ? existing : { ...existing, sortOrder: Object.keys(newSettings).length }
    } else {
      newSettings[itemId] = { sortOrder: Object.keys(newSettings).length }
    }
    return { itemSettings: newSettings, activeItemId: itemId, focusedItemId: itemId }
  },

  removeItem(state, itemId, podItems) {
    const items = this.buildViewItems(state, podItems)
    const closedIndex = items.findIndex((i) => i.id === itemId)

    const newSettings = { ...state.itemSettings }
    delete newSettings[itemId]

    const remainingItems = items.filter((i) => i.id !== itemId)
    const newFocusedItemId =
      state.activeItemId === itemId
        ? (remainingItems[Math.min(closedIndex, remainingItems.length - 1)]?.id ?? null)
        : state.activeItemId

    return {
      itemSettings: newSettings,
      activeItemId: newFocusedItemId,
      newFocusedItemId,
    }
  },

  getNextItemId(_state, _currentId) {
    // Tabs requires podItems to build the list — handled at the store level
    return null
  },

  getPrevItemId(_state, _currentId) {
    return null
  },

  getItemIdAtIndex(_state, _index) {
    return null
  },

  buildViewItems(state, podItems) {
    return podItems
      .map((pi) => podItemToViewItem(pi, state.itemSettings[pi.id]))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  },

  createInitialState(podItems, itemSettings) {
    const visibleItems = podItems.sort(
      (a, b) => (itemSettings[a.id]?.sortOrder ?? a.sortOrder) - (itemSettings[b.id]?.sortOrder ?? b.sortOrder),
    )
    const focusedItemId = visibleItems[0]?.id ?? null

    return {
      viewType: 'tabs',
      activeItemId: focusedItemId,
      focusedItemId,
      layout: null,
      paneTabs: null,
      gridWidgets: null,
      carouselItems: null,
      columnsRows: null,
      canvasNodes: null,
      canvasViewport: null,
    }
  },

  buildConfig() {
    return { type: 'tabs' as const }
  },

  addItemToActiveView(_state, newItemId) {
    return { activeItemId: newItemId, focusedItemId: newItemId }
  },

  addItemToOtherView() {
    return {}
  },

  reconcile(state, validIds) {
    if (state.activeItemId && validIds.has(state.activeItemId)) {
      return { newFocusedItemId: state.activeItemId }
    }
    const visibleIds = [...validIds]
    const firstVisible =
      visibleIds.sort((a, b) => (state.itemSettings[a]?.sortOrder ?? 0) - (state.itemSettings[b]?.sortOrder ?? 0))[0] ??
      null
    return { newFocusedItemId: firstVisible }
  },
}

const canvasStrategy: ViewTypeStrategy = {
  getItemIds(state) {
    return state.canvasNodes ? canvasNodeItemIds(state.canvasNodes) : []
  },

  containsItem(state, itemId) {
    return state.canvasNodes?.some((n) => n.itemId === itemId) ?? false
  },

  addItem(state, itemId) {
    const nodes = state.canvasNodes ? [...state.canvasNodes] : []
    if (nodes.some((n) => n.itemId === itemId)) return {}
    const pos = findFreeCanvasPosition(nodes)
    nodes.push({ itemId, ...pos, width: 600, height: 420 })
    return { canvasNodes: nodes, focusedItemId: itemId, activeItemId: itemId }
  },

  removeItem(state, itemId) {
    const newNodes = (state.canvasNodes ?? []).filter((n) => n.itemId !== itemId)
    const newFocusedItemId = state.focusedItemId === itemId ? (newNodes[0]?.itemId ?? null) : state.focusedItemId
    return { canvasNodes: newNodes, newFocusedItemId }
  },

  getNextItemId(state, currentId) {
    return linearNext(this.getItemIds(state), currentId)
  },

  getPrevItemId(state, currentId) {
    return linearPrev(this.getItemIds(state), currentId)
  },

  getItemIdAtIndex(state, index) {
    return state.canvasNodes?.[index]?.itemId ?? null
  },

  buildViewItems(state, podItems) {
    if (!state.canvasNodes) return []
    const ids = new Set(canvasNodeItemIds(state.canvasNodes))
    return podItemsToViewItemsByIds(podItems, ids, state.itemSettings)
  },

  createInitialState(podItems, _itemSettings) {
    const podItemIds = new Set(podItems.map((pi) => pi.id))
    const nodes: CanvasNode[] = podItems
      .filter((pi) => podItemIds.has(pi.id))
      .map((pi, i) => ({
        itemId: pi.id,
        x: (i % 3) * 640,
        y: Math.floor(i / 3) * 460,
        width: 600,
        height: 420,
      }))
    const focusedItemId = nodes[0]?.itemId ?? null
    return {
      viewType: 'canvas' as const,
      activeItemId: focusedItemId,
      focusedItemId,
      layout: null,
      paneTabs: null,
      gridWidgets: null,
      carouselItems: null,
      columnsRows: null,
      canvasNodes: nodes,
      canvasViewport: null,
    }
  },

  buildConfig(state) {
    if (!state.canvasNodes) return null
    return {
      type: 'canvas' as const,
      nodes: state.canvasNodes,
      ...(state.canvasViewport ? { viewport: state.canvasViewport } : {}),
    }
  },

  addItemToActiveView(state, newItemId) {
    const nodes = state.canvasNodes ? [...state.canvasNodes] : []
    const pos = findFreeCanvasPosition(nodes)
    nodes.push({ itemId: newItemId, ...pos, width: 600, height: 420 })
    return { canvasNodes: nodes, focusedItemId: newItemId, activeItemId: newItemId }
  },

  addItemToOtherView(state, newItemId) {
    const nodes = state.canvasNodes ? [...state.canvasNodes] : []
    if (!nodes.some((n) => n.itemId === newItemId)) {
      const pos = findFreeCanvasPosition(nodes)
      nodes.push({ itemId: newItemId, ...pos, width: 600, height: 420 })
    }
    return {
      canvasNodes: nodes,
      focusedItemId: state.focusedItemId ?? newItemId,
      activeItemId: state.activeItemId ?? newItemId,
    }
  },

  reconcile(state, validIds) {
    const newNodes = (state.canvasNodes ?? []).filter((n) => validIds.has(n.itemId))
    const newFocusedItemId =
      state.focusedItemId && newNodes.some((n) => n.itemId === state.focusedItemId)
        ? state.focusedItemId
        : (newNodes[0]?.itemId ?? null)
    return { canvasNodes: newNodes, focusedItemId: newFocusedItemId, activeItemId: newFocusedItemId, newFocusedItemId }
  },
}

const carouselStrategy: ViewTypeStrategy = {
  getItemIds(state) {
    return state.carouselItems ? carouselItemIds(state.carouselItems) : []
  },

  containsItem(state, itemId) {
    return state.carouselItems?.some((i) => i.itemId === itemId) ?? false
  },

  addItem(state, itemId) {
    const items = state.carouselItems ? [...state.carouselItems] : []
    if (items.some((i) => i.itemId === itemId)) return {}
    items.push({ itemId, width: 520 })
    return { carouselItems: items, focusedItemId: itemId, activeItemId: itemId }
  },

  removeItem(state, itemId) {
    const newItems = (state.carouselItems ?? []).filter((i) => i.itemId !== itemId)
    const newFocusedItemId = state.focusedItemId === itemId ? (newItems[0]?.itemId ?? null) : state.focusedItemId
    return { carouselItems: newItems, newFocusedItemId }
  },

  getNextItemId(state, currentId) {
    return linearNext(this.getItemIds(state), currentId)
  },

  getPrevItemId(state, currentId) {
    return linearPrev(this.getItemIds(state), currentId)
  },

  getItemIdAtIndex(state, index) {
    return state.carouselItems?.[index]?.itemId ?? null
  },

  buildViewItems(state, podItems) {
    if (!state.carouselItems) return []
    const ids = new Set(carouselItemIds(state.carouselItems))
    return podItemsToViewItemsByIds(podItems, ids, state.itemSettings)
  },

  createInitialState(podItems, _itemSettings) {
    const items: CarouselItem[] = podItems.map((pi) => ({ itemId: pi.id, width: 520 }))
    const focusedItemId = items[0]?.itemId ?? null
    return {
      viewType: 'carousel' as const,
      activeItemId: focusedItemId,
      focusedItemId,
      layout: null,
      paneTabs: null,
      gridWidgets: null,
      carouselItems: items,
      columnsRows: null,
      canvasNodes: null,
      canvasViewport: null,
    }
  },

  buildConfig(state) {
    if (!state.carouselItems) return null
    return { type: 'carousel' as const, items: state.carouselItems }
  },

  addItemToActiveView(state, newItemId) {
    const items = state.carouselItems ? [...state.carouselItems] : []
    items.push({ itemId: newItemId, width: 520 })
    return { carouselItems: items, focusedItemId: newItemId, activeItemId: newItemId }
  },

  addItemToOtherView(state, newItemId) {
    const items = state.carouselItems ? [...state.carouselItems] : []
    if (!items.some((i) => i.itemId === newItemId)) {
      items.push({ itemId: newItemId, width: 520 })
    }
    return {
      carouselItems: items,
      focusedItemId: state.focusedItemId ?? newItemId,
      activeItemId: state.activeItemId ?? newItemId,
    }
  },

  reconcile(state, validIds) {
    const newItems = (state.carouselItems ?? []).filter((i) => validIds.has(i.itemId))
    const newFocusedItemId =
      state.focusedItemId && newItems.some((i) => i.itemId === state.focusedItemId)
        ? state.focusedItemId
        : (newItems[0]?.itemId ?? null)
    return {
      carouselItems: newItems,
      focusedItemId: newFocusedItemId,
      activeItemId: newFocusedItemId,
      newFocusedItemId,
    }
  },
}

const columnsStrategy: ViewTypeStrategy = {
  getItemIds(state) {
    return state.columnsRows ? columnsItemIds(state.columnsRows) : []
  },

  containsItem(state, itemId) {
    return state.columnsRows ? columnsItemIds(state.columnsRows).includes(itemId) : false
  },

  addItem(state, itemId) {
    const rows = state.columnsRows ? structuredClone(state.columnsRows) : [{ items: [] }]
    if (columnsItemIds(rows).includes(itemId)) return {}
    if (rows.length === 0) rows.push({ items: [] })
    const firstRow = rows[0]
    if (!firstRow) return {}
    firstRow.items.push({ itemId, width: 520 })
    return { columnsRows: rows, focusedItemId: itemId, activeItemId: itemId }
  },

  removeItem(state, itemId) {
    const newRows = (state.columnsRows ?? [])
      .map((r) => ({ items: r.items.filter((i) => i.itemId !== itemId) }))
      .filter((r) => r.items.length > 0)
    const allIds = columnsItemIds(newRows)
    const newFocusedItemId = state.focusedItemId === itemId ? (allIds[0] ?? null) : state.focusedItemId
    return { columnsRows: newRows, newFocusedItemId }
  },

  getNextItemId(state, currentId) {
    return linearNext(this.getItemIds(state), currentId)
  },

  getPrevItemId(state, currentId) {
    return linearPrev(this.getItemIds(state), currentId)
  },

  getItemIdAtIndex(state, index) {
    const ids = this.getItemIds(state)
    return ids[index] ?? null
  },

  buildViewItems(state, podItems) {
    if (!state.columnsRows) return []
    const ids = new Set(columnsItemIds(state.columnsRows))
    return podItemsToViewItemsByIds(podItems, ids, state.itemSettings)
  },

  createInitialState(podItems, _itemSettings) {
    const byPod = new Map<string, { itemId: string; width: number }[]>()
    for (const pi of podItems) {
      const key = pi.podId ?? ''
      let arr = byPod.get(key)
      if (!arr) {
        arr = []
        byPod.set(key, arr)
      }
      arr.push({ itemId: pi.id, width: 520 })
    }
    const rows: ColumnsRow[] = [...byPod.values()].map((items) => ({ items }))
    if (rows.length === 0) rows.push({ items: [] })
    const focusedItemId = rows[0]?.items[0]?.itemId ?? null
    return {
      viewType: 'columns' as const,
      activeItemId: focusedItemId,
      focusedItemId,
      layout: null,
      paneTabs: null,
      gridWidgets: null,
      carouselItems: null,
      columnsRows: rows,
      canvasNodes: null,
      canvasViewport: null,
    }
  },

  buildConfig(state) {
    if (!state.columnsRows) return null
    return { type: 'columns' as const, rows: state.columnsRows }
  },

  addItemToActiveView(state, newItemId) {
    const rows = state.columnsRows ? structuredClone(state.columnsRows) : [{ items: [] }]
    if (rows.length === 0) rows.push({ items: [] })
    const firstRow = rows[0]
    if (firstRow) firstRow.items.push({ itemId: newItemId, width: 520 })
    return { columnsRows: rows, focusedItemId: newItemId, activeItemId: newItemId }
  },

  addItemToOtherView(state, newItemId) {
    const rows = state.columnsRows ? structuredClone(state.columnsRows) : [{ items: [] }]
    if (!columnsItemIds(rows).includes(newItemId)) {
      if (rows.length === 0) rows.push({ items: [] })
      const firstRow = rows[0]
      if (firstRow) firstRow.items.push({ itemId: newItemId, width: 520 })
    }
    return {
      columnsRows: rows,
      focusedItemId: state.focusedItemId ?? newItemId,
      activeItemId: state.activeItemId ?? newItemId,
    }
  },

  reconcile(state, validIds) {
    const newRows = (state.columnsRows ?? [])
      .map((r) => ({ items: r.items.filter((i) => validIds.has(i.itemId)) }))
      .filter((r) => r.items.length > 0)
    const allIds = columnsItemIds(newRows)
    const newFocusedItemId =
      state.focusedItemId && allIds.includes(state.focusedItemId) ? state.focusedItemId : (allIds[0] ?? null)
    return { columnsRows: newRows, focusedItemId: newFocusedItemId, activeItemId: newFocusedItemId, newFocusedItemId }
  },
}

const gridStrategy: ViewTypeStrategy = {
  getItemIds(state) {
    return state.gridWidgets ? state.gridWidgets.map((w) => w.itemId) : []
  },

  containsItem(state, itemId) {
    return state.gridWidgets?.some((w) => w.itemId === itemId) ?? false
  },

  addItem(state, itemId) {
    const widgets = state.gridWidgets ? [...state.gridWidgets] : []
    if (widgets.some((w) => w.itemId === itemId)) return {}
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    widgets.push({ itemId, x: 0, y: maxY, w: 6, h: 4 })
    return { gridWidgets: widgets, focusedItemId: itemId, activeItemId: itemId }
  },

  removeItem(state, itemId) {
    const newWidgets = (state.gridWidgets ?? []).filter((w) => w.itemId !== itemId)
    const newFocusedItemId = state.focusedItemId === itemId ? (newWidgets[0]?.itemId ?? null) : state.focusedItemId
    return { gridWidgets: newWidgets, newFocusedItemId }
  },

  getNextItemId(state, currentId) {
    return linearNext(this.getItemIds(state), currentId)
  },

  getPrevItemId(state, currentId) {
    return linearPrev(this.getItemIds(state), currentId)
  },

  getItemIdAtIndex(state, index) {
    return state.gridWidgets?.[index]?.itemId ?? null
  },

  buildViewItems(state, podItems) {
    if (!state.gridWidgets) return []
    const ids = new Set(state.gridWidgets.map((w) => w.itemId))
    return podItemsToViewItemsByIds(podItems, ids, state.itemSettings)
  },

  createInitialState(podItems, _itemSettings) {
    const widgets: GridWidget[] = podItems.map((pi, i) => ({
      itemId: pi.id,
      x: (i % 2) * 6,
      y: Math.floor(i / 2) * 4,
      w: 6,
      h: 4,
    }))
    const focusedItemId = widgets[0]?.itemId ?? null
    return {
      viewType: 'grid' as const,
      activeItemId: focusedItemId,
      focusedItemId,
      layout: null,
      paneTabs: null,
      gridWidgets: widgets,
      carouselItems: null,
      columnsRows: null,
      canvasNodes: null,
      canvasViewport: null,
    }
  },

  buildConfig(state) {
    if (!state.gridWidgets) return null
    return { type: 'grid' as const, widgets: state.gridWidgets }
  },

  addItemToActiveView(state, newItemId) {
    const widgets = state.gridWidgets ? [...state.gridWidgets] : []
    const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
    widgets.push({ itemId: newItemId, x: 0, y: maxY, w: 6, h: 4 })
    return { gridWidgets: widgets, focusedItemId: newItemId, activeItemId: newItemId }
  },

  addItemToOtherView(state, newItemId) {
    const widgets = state.gridWidgets ? [...state.gridWidgets] : []
    if (!widgets.some((w) => w.itemId === newItemId)) {
      const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
      widgets.push({ itemId: newItemId, x: 0, y: maxY, w: 6, h: 4 })
    }
    return {
      gridWidgets: widgets,
      focusedItemId: state.focusedItemId ?? newItemId,
      activeItemId: state.activeItemId ?? newItemId,
    }
  },

  reconcile(state, validIds) {
    const newWidgets = (state.gridWidgets ?? []).filter((w) => validIds.has(w.itemId))
    const newFocusedItemId =
      state.focusedItemId && newWidgets.some((w) => w.itemId === state.focusedItemId)
        ? state.focusedItemId
        : (newWidgets[0]?.itemId ?? null)
    return {
      gridWidgets: newWidgets,
      focusedItemId: newFocusedItemId,
      activeItemId: newFocusedItemId,
      newFocusedItemId,
    }
  },
}

/** Resolve focus for split-pane: find the active tab of the current pane, or first pane. */
function splitPaneFocusAfterRemove(
  layout: SplitNode | null,
  paneTabs: Record<string, PaneTabGroup> | null,
  previousFocusedId: string | null,
  removedItemId: string,
  removedPaneId: string | null,
): string | null {
  if (!layout) return null

  if (paneTabs && Object.keys(paneTabs).length > 0) {
    if (previousFocusedId && previousFocusedId !== removedItemId) {
      if (findPaneForItem(paneTabs, previousFocusedId)) return previousFocusedId
    }
    // Focus the active tab of the same pane (if it still exists), or the first pane
    const removedGroup = removedPaneId ? paneTabs[removedPaneId] : undefined
    if (removedGroup) {
      return removedGroup.activeTabId ?? removedGroup.tabIds[0] ?? null
    }
    const firstPaneId = collectLeafIds(layout)[0]
    const firstGroup = firstPaneId ? paneTabs[firstPaneId] : undefined
    return firstGroup ? (firstGroup.activeTabId ?? firstGroup.tabIds[0] ?? null) : null
  }

  // No paneTabs — legacy mode
  const focusedStillExists =
    previousFocusedId && previousFocusedId !== removedItemId ? findLeaf(layout, previousFocusedId) !== null : false
  return focusedStillExists ? previousFocusedId : (collectLeafIds(layout)[0] ?? null)
}

const splitPaneStrategy: ViewTypeStrategy = {
  getItemIds(state) {
    if (state.paneTabs) return paneTabItemIds(state.paneTabs)
    if (state.layout) return collectLeafIds(state.layout)
    return []
  },

  containsItem(state, itemId) {
    if (state.paneTabs) return findPaneForItem(state.paneTabs, itemId) !== null
    if (state.layout) return findLeaf(state.layout, itemId) !== null
    return false
  },

  addItem(state, itemId) {
    if (state.layout && state.paneTabs && state.focusedItemId) {
      const paneId = findPaneForItem(state.paneTabs, state.focusedItemId)
      const existingGroup = paneId ? state.paneTabs[paneId] : undefined
      if (paneId && existingGroup) {
        const newPaneTabs = { ...state.paneTabs }
        const group = { ...existingGroup }
        if (!group.tabIds.includes(itemId)) {
          group.tabIds = [...group.tabIds, itemId]
        }
        group.activeTabId = itemId
        newPaneTabs[paneId] = group
        return { paneTabs: newPaneTabs, focusedItemId: itemId, activeItemId: itemId }
      }
    }

    if (!state.layout) {
      const newLayout: SplitNode = { type: 'leaf', itemId }
      const newPaneTabs: Record<string, PaneTabGroup> = { [itemId]: { tabIds: [itemId], activeTabId: itemId } }
      return { layout: newLayout, paneTabs: newPaneTabs, focusedItemId: itemId, activeItemId: itemId }
    }

    return {}
  },

  removeItem(state, itemId) {
    if (state.layout && state.paneTabs) {
      const paneId = findPaneForItem(state.paneTabs, itemId)
      const existingGroup = paneId ? state.paneTabs[paneId] : undefined
      if (paneId && existingGroup) {
        const newPaneTabs = { ...state.paneTabs }
        const group = { ...existingGroup }
        group.tabIds = group.tabIds.filter((id) => id !== itemId)

        let newLayout: SplitNode | null = state.layout
        if (group.tabIds.length === 0) {
          delete newPaneTabs[paneId]
          newLayout = removeLeaf(state.layout, paneId)
        } else {
          if (group.activeTabId === itemId) {
            group.activeTabId = group.tabIds[0] ?? null
          }
          newPaneTabs[paneId] = group
        }

        const newFocusedItemId = splitPaneFocusAfterRemove(newLayout, newPaneTabs, state.focusedItemId, itemId, paneId)

        return { layout: newLayout, paneTabs: newPaneTabs, newFocusedItemId }
      }
    }

    // Legacy split-pane without paneTabs
    if (state.layout) {
      const newLayout = removeLeaf(state.layout, itemId)
      const newFocusedItemId = newLayout
        ? state.focusedItemId === itemId
          ? (nextLeaf(state.layout, itemId) ?? collectLeafIds(newLayout)[0] ?? null)
          : state.focusedItemId
        : null
      return { layout: newLayout, newFocusedItemId }
    }

    return { newFocusedItemId: state.focusedItemId }
  },

  getNextItemId(state, currentId) {
    if (state.layout && state.paneTabs) {
      const currentPaneId = findPaneForItem(state.paneTabs, currentId)
      if (currentPaneId) {
        const nextPaneId = nextLeaf(state.layout, currentPaneId)
        if (nextPaneId && state.paneTabs[nextPaneId]) {
          return state.paneTabs[nextPaneId].activeTabId ?? state.paneTabs[nextPaneId].tabIds[0] ?? null
        }
      }
      return null
    }
    if (state.layout) return nextLeaf(state.layout, currentId)
    return null
  },

  getPrevItemId(state, currentId) {
    if (state.layout && state.paneTabs) {
      const currentPaneId = findPaneForItem(state.paneTabs, currentId)
      if (currentPaneId) {
        const prevPaneId = prevLeaf(state.layout, currentPaneId)
        if (prevPaneId && state.paneTabs[prevPaneId]) {
          return state.paneTabs[prevPaneId].activeTabId ?? state.paneTabs[prevPaneId].tabIds[0] ?? null
        }
      }
      return null
    }
    if (state.layout) return prevLeaf(state.layout, currentId)
    return null
  },

  getItemIdAtIndex(state, index) {
    if (state.layout) {
      const paneId = leafAtIndex(state.layout, index)
      if (paneId && state.paneTabs?.[paneId]) {
        return state.paneTabs[paneId].activeTabId ?? state.paneTabs[paneId].tabIds[0] ?? null
      }
      return paneId
    }
    return null
  },

  buildViewItems(state, podItems) {
    if (!state.layout) return []
    const visibleIds = state.paneTabs ? new Set(paneTabItemIds(state.paneTabs)) : new Set(collectLeafIds(state.layout))
    return podItemsToViewItemsByIds(podItems, visibleIds, state.itemSettings)
  },

  createInitialState(podItems, itemSettings) {
    let layout: SplitNode | null = null
    const visibleItems = podItems.sort(
      (a, b) => (itemSettings[a.id]?.sortOrder ?? a.sortOrder) - (itemSettings[b.id]?.sortOrder ?? b.sortOrder),
    )

    for (const item of visibleItems) {
      if (!layout) {
        layout = { type: 'leaf', itemId: item.id }
      } else {
        const leaves = collectLeafIds(layout)
        const lastLeaf = leaves[leaves.length - 1]
        if (lastLeaf) layout = splitLeaf(layout, lastLeaf, 'horizontal', item.id)
      }
    }

    let paneTabs: Record<string, PaneTabGroup> | null = null
    if (layout) {
      paneTabs = buildPaneTabsFromLayout(layout)
    }

    let focusedItemId: string | null = null
    if (layout && paneTabs) {
      const firstPaneId = collectLeafIds(layout)[0]
      if (firstPaneId && paneTabs[firstPaneId]) {
        focusedItemId = paneTabs[firstPaneId].activeTabId ?? paneTabs[firstPaneId].tabIds[0] ?? null
      }
    }

    return {
      viewType: 'split-pane' as const,
      activeItemId: focusedItemId,
      focusedItemId,
      layout,
      paneTabs,
      gridWidgets: null,
      carouselItems: null,
      columnsRows: null,
      canvasNodes: null,
      canvasViewport: null,
    }
  },

  buildConfig(state) {
    if (!state.layout) return null
    return {
      type: 'split-pane' as const,
      layout: state.layout,
      ...(state.paneTabs ? { paneTabs: state.paneTabs } : {}),
    }
  },

  addItemToActiveView(state, newItemId, direction) {
    const newPaneTabs = state.paneTabs ? { ...state.paneTabs } : {}

    let focusedPaneId: string | null = null
    if (state.focusedItemId) {
      focusedPaneId = findPaneForItem(newPaneTabs, state.focusedItemId)
    }

    let activeLayout: SplitNode
    const targetPaneId = focusedPaneId
    if (state.layout && targetPaneId) {
      activeLayout = splitLeaf(state.layout, targetPaneId, direction, newItemId)
    } else if (state.layout) {
      const leaves = collectLeafIds(state.layout)
      const lastLeaf = leaves[leaves.length - 1]
      activeLayout = lastLeaf ? splitLeaf(state.layout, lastLeaf, direction, newItemId) : state.layout
    } else {
      activeLayout = { type: 'leaf', itemId: newItemId }
    }

    newPaneTabs[newItemId] = { tabIds: [newItemId], activeTabId: newItemId }

    return {
      layout: activeLayout,
      paneTabs: newPaneTabs,
      focusedItemId: newItemId,
      activeItemId: newItemId,
    }
  },

  addItemToOtherView(state, newItemId) {
    let otherLayout = state.layout
    const otherPaneTabs = state.paneTabs ? { ...state.paneTabs } : {}
    if (otherLayout) {
      if (!findLeaf(otherLayout, newItemId)) {
        const leaves = collectLeafIds(otherLayout)
        const lastLeaf = leaves[leaves.length - 1]
        if (lastLeaf) {
          otherLayout = splitLeaf(otherLayout, lastLeaf, 'horizontal', newItemId)
          otherPaneTabs[newItemId] = { tabIds: [newItemId], activeTabId: newItemId }
        }
      }
    } else {
      otherLayout = { type: 'leaf', itemId: newItemId }
      otherPaneTabs[newItemId] = { tabIds: [newItemId], activeTabId: newItemId }
    }
    return {
      layout: otherLayout,
      paneTabs: otherPaneTabs,
      focusedItemId: state.focusedItemId ?? newItemId,
      activeItemId: state.activeItemId ?? newItemId,
    }
  },

  reconcile(state, validIds) {
    let newLayout = state.layout
    const newPaneTabs = state.paneTabs ? { ...state.paneTabs } : null

    if (newPaneTabs) {
      for (const [paneId, group] of Object.entries(newPaneTabs)) {
        const filtered = group.tabIds.filter((id) => validIds.has(id))
        if (filtered.length === 0) {
          delete newPaneTabs[paneId]
          if (newLayout) newLayout = removeLeaf(newLayout, paneId)
        } else {
          newPaneTabs[paneId] = {
            tabIds: filtered,
            activeTabId:
              group.activeTabId && validIds.has(group.activeTabId) ? group.activeTabId : (filtered[0] ?? null),
          }
        }
      }
    } else if (newLayout) {
      const leafIds = collectLeafIds(newLayout)
      for (const leafId of leafIds) {
        if (!validIds.has(leafId)) {
          newLayout = newLayout ? removeLeaf(newLayout, leafId) : null
        }
      }
    }

    let newFocusedItemId: string | null = null
    if (newLayout && newPaneTabs && Object.keys(newPaneTabs).length > 0) {
      if (state.focusedItemId && findPaneForItem(newPaneTabs, state.focusedItemId)) {
        newFocusedItemId = state.focusedItemId
      } else {
        const firstPaneId = collectLeafIds(newLayout)[0]
        newFocusedItemId =
          firstPaneId && newPaneTabs[firstPaneId] ? (newPaneTabs[firstPaneId].activeTabId ?? null) : null
      }
    } else if (newLayout) {
      const focusedStillExists = state.focusedItemId ? findLeaf(newLayout, state.focusedItemId) !== null : false
      newFocusedItemId = focusedStillExists ? state.focusedItemId : (collectLeafIds(newLayout)[0] ?? null)
    }

    return {
      layout: newLayout,
      paneTabs: newPaneTabs,
      focusedItemId: newFocusedItemId,
      activeItemId: newFocusedItemId,
      newFocusedItemId,
    }
  },
}

export const viewStrategies: Record<ViewType, ViewTypeStrategy> = {
  tabs: tabsStrategy,
  'split-pane': splitPaneStrategy,
  grid: gridStrategy,
  carousel: carouselStrategy,
  columns: columnsStrategy,
  canvas: canvasStrategy,
}

export { buildPaneTabsFromLayout }
