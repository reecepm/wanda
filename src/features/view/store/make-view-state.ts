import { collectLeafIds, removeLeaf, type SplitNode } from '@/features/view/utils/split-tree'
import {
  buildPaneTabsFromLayout,
  type PerViewState,
  type PodItem,
  viewStrategies,
} from '@/features/view/utils/view-strategies'
import type {
  CanvasViewConfig,
  CarouselViewConfig,
  ColumnsViewConfig,
  GridViewConfig,
  PaneTabGroup,
  SplitPaneViewConfig,
  ViewItemSettings,
} from '@/types/schema'
import type { DBView } from './view-store'

export function makeViewState(dbView: DBView, podItems: PodItem[]): PerViewState {
  const itemSettings: Record<string, ViewItemSettings> = {}
  for (const pi of podItems) {
    const existing = dbView.itemSettings[pi.id]
    itemSettings[pi.id] = existing ?? { sortOrder: pi.sortOrder }
  }

  const baseFields = { id: dbView.id, name: dbView.name, itemSettings }
  const nullFields = {
    layout: null,
    paneTabs: null,
    gridWidgets: null,
    carouselItems: null,
    columnsRows: null,
    canvasNodes: null,
    canvasViewport: null,
  }

  const podItemIds = new Set(podItems.map((pi) => pi.id))
  const storedFocusedId =
    dbView.config && 'focusedItemId' in dbView.config && typeof dbView.config.focusedItemId === 'string'
      ? dbView.config.focusedItemId
      : null
  const restoredFocusId = storedFocusedId && podItemIds.has(storedFocusedId) ? storedFocusedId : null

  if (dbView.config?.type === 'carousel') {
    const config = dbView.config as CarouselViewConfig
    const items = config.items.filter((i) => podItemIds.has(i.itemId))
    const focusedItemId = restoredFocusId ?? items[0]?.itemId ?? null
    return {
      ...baseFields,
      ...nullFields,
      viewType: 'carousel',
      activeItemId: focusedItemId,
      focusedItemId,
      carouselItems: items,
    }
  }

  if (dbView.config?.type === 'columns') {
    const config = dbView.config as ColumnsViewConfig
    const rows = config.rows
      .map((r) => ({ items: r.items.filter((i) => podItemIds.has(i.itemId)) }))
      .filter((r) => r.items.length > 0)
    const focusedItemId = restoredFocusId ?? rows[0]?.items[0]?.itemId ?? null
    return {
      ...baseFields,
      ...nullFields,
      viewType: 'columns',
      activeItemId: focusedItemId,
      focusedItemId,
      columnsRows: rows,
    }
  }

  if (dbView.config?.type === 'canvas') {
    const config = dbView.config as CanvasViewConfig
    const nodes = config.nodes.filter((n) => podItemIds.has(n.itemId))
    const focusedItemId = restoredFocusId ?? nodes[0]?.itemId ?? null
    return {
      ...baseFields,
      ...nullFields,
      viewType: 'canvas',
      activeItemId: focusedItemId,
      focusedItemId,
      canvasNodes: nodes,
      canvasViewport: config.viewport ?? null,
    }
  }

  if (dbView.config?.type === 'grid') {
    const gridConfig = dbView.config as GridViewConfig
    const widgets = gridConfig.widgets.filter((w) => podItemIds.has(w.itemId))
    const focusedItemId = restoredFocusId ?? widgets[0]?.itemId ?? null
    return {
      ...baseFields,
      ...nullFields,
      viewType: 'grid',
      activeItemId: focusedItemId,
      focusedItemId,
      gridWidgets: widgets,
    }
  }

  if (dbView.config?.type === 'tabs') {
    const strategy = viewStrategies.tabs
    const partial = strategy.createInitialState(podItems, itemSettings)
    const focusedItemId = restoredFocusId ?? partial.focusedItemId ?? null
    return { ...baseFields, ...nullFields, viewType: 'tabs', activeItemId: focusedItemId, focusedItemId }
  }

  if (dbView.config?.type === 'split-pane' && (dbView.config as SplitPaneViewConfig).layout) {
    const splitConfig = dbView.config as SplitPaneViewConfig
    let layout: SplitNode | null = splitConfig.layout
    let paneTabs: Record<string, PaneTabGroup> | null = splitConfig.paneTabs ? { ...splitConfig.paneTabs } : null

    if (paneTabs) {
      for (const [, group] of Object.entries(paneTabs)) {
        group.tabIds = group.tabIds.filter((id) => podItemIds.has(id))
        if (group.activeTabId && !podItemIds.has(group.activeTabId)) {
          group.activeTabId = group.tabIds[0] ?? null
        }
      }
      for (const [paneId, group] of Object.entries(paneTabs)) {
        if (group.tabIds.length === 0) {
          delete paneTabs[paneId]
          if (layout) layout = removeLeaf(layout, paneId)
        }
      }
    } else {
      const leafNodeIds = collectLeafIds(layout)
      for (const leafId of leafNodeIds) {
        if (!podItemIds.has(leafId)) {
          layout = layout ? removeLeaf(layout, leafId) : null
        }
      }
    }

    if (!paneTabs && layout) {
      paneTabs = buildPaneTabsFromLayout(layout)
    }

    let focusedItemId: string | null = restoredFocusId
    if (!focusedItemId && layout && paneTabs) {
      const firstPaneId = collectLeafIds(layout)[0]
      if (firstPaneId && paneTabs[firstPaneId]) {
        focusedItemId = paneTabs[firstPaneId].activeTabId ?? paneTabs[firstPaneId].tabIds[0] ?? null
      }
    }

    return {
      ...baseFields,
      ...nullFields,
      viewType: 'split-pane',
      activeItemId: focusedItemId,
      focusedItemId,
      layout,
      paneTabs,
    }
  }

  // Auto-migrate from tabs: use split-pane strategy's createInitialState
  const strategy = viewStrategies['split-pane']
  const partial = strategy.createInitialState(podItems, itemSettings)
  return {
    ...baseFields,
    ...nullFields,
    viewType: 'split-pane',
    activeItemId: partial.activeItemId ?? null,
    focusedItemId: partial.focusedItemId ?? null,
    layout: partial.layout ?? null,
    paneTabs: partial.paneTabs ?? null,
  }
}
