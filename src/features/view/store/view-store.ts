import { create } from 'zustand'
import {
  collectLeafIds,
  findPaneForItem,
  removeLeaf,
  type SplitNode,
  swapLeaves,
  updateSizes,
} from '@/features/view/utils/split-tree'
import type { PerViewState, PodItem, ViewItem, ViewType } from '@/features/view/utils/view-strategies'
import { orpcForPod } from '@/shared/orpc'
import type {
  CanvasNode,
  CanvasViewConfig,
  CarouselItem,
  CarouselViewConfig,
  ColumnsRow,
  ColumnsViewConfig,
  GridViewConfig,
  GridWidget,
  SplitPaneViewConfig,
  ViewItemSettings,
} from '@/types/schema'
import {
  _entity,
  _setEntity,
  buildPaneTabsFromLayout,
  buildViewItems,
  columnsItemIds,
  deepEqual,
  findActiveView,
  getStrategy,
} from './helpers'
import { makeViewState } from './make-view-state'
import {
  debouncedPersist,
  flushDebouncedPersist,
  type PersistenceScope,
  type PersistenceStrategy,
  podPersistence,
  workspacePersistence,
} from './persistence-strategy'

export type { PodItem, ViewItem, PerViewState }

export interface DBView {
  id: string
  name: string
  viewType: string
  config?: { type: string; [key: string]: unknown } | null
  itemSettings: Record<string, ViewItemSettings>
}

export interface ScopeState {
  podItems: PodItem[]
  views: PerViewState[]
  activeViewId: string | null
  scope: PersistenceScope
}

/** @deprecated Use ScopeState instead */
export type PodState = ScopeState

export interface ViewStore {
  activeEntityId: string | null
  entities: Record<string, ScopeState>

  load: (
    entityId: string,
    views: DBView[],
    podItems: PodItem[],
    activeViewId: string | null,
    scope?: PersistenceScope,
  ) => void
  reconcileViewsFromServer: (entityId: string, views: DBView[]) => void

  addView: (entityId: string, name: string, viewType?: ViewType) => Promise<string>
  removeView: (viewId: string, entityId: string) => Promise<void>
  switchView: (viewId: string, entityId: string) => void
  renameView: (viewId: string, name: string) => void
  duplicateView: (viewId: string, entityId: string) => Promise<string>

  setActiveItem: (itemId: string | null) => void
  moveItem: (fromIndex: number, toIndex: number) => void

  splitPane: (direction: 'horizontal' | 'vertical', newItemId: string) => void
  closeFocusedPane: () => void
  focusPane: (itemId: string) => void
  updatePaneSizes: (path: number[], sizes: [number, number]) => void
  focusNextPane: () => void
  focusPrevPane: () => void
  focusPaneByIndex: (index: number) => void
  swapPanes: (idA: string, idB: string) => void

  addTabToPane: (paneId: string, itemId: string) => void
  removeTabFromPane: (paneId: string, itemId: string) => void
  setActiveTabInPane: (paneId: string, itemId: string) => void
  focusTabByIndex: (index: number) => void

  updateGridLayout: (widgets: GridWidget[]) => void
  addGridWidget: (itemId: string) => void

  updateCarouselItems: (items: CarouselItem[]) => void
  resizeCarouselItem: (itemId: string, width: number) => void

  updateColumnsRows: (rows: ColumnsRow[]) => void
  resizeColumnsItem: (rowIndex: number, itemId: string, width: number) => void
  addColumnsRow: () => void
  removeColumnsRow: (rowIndex: number) => void
  moveItemToRow: (itemId: string, targetRowIndex: number) => void

  updateCanvasNodes: (nodes: CanvasNode[]) => void
  updateCanvasNode: (itemId: string, updates: Partial<Omit<CanvasNode, 'itemId'>>) => void
  updateCanvasViewport: (viewport: { x: number; y: number; zoom: number }, entityId: string) => void

  updatePodItems: (items: PodItem[]) => void
  replacePodItem: (temporaryItemId: string, item: PodItem, items?: PodItem[]) => void
  updatePodItemConfig: (itemId: string, config: PodItem['config']) => void
  renamePodItem: (itemId: string, label: string) => void
  autoRenamePodItem: (idOrPodTerminalId: string, label: string) => void

  deleteItem: (itemId: string) => void
  reconcile: (newPodItems: PodItem[]) => void
  clear: () => void
}

function _strategy(get: () => ViewStore): PersistenceStrategy {
  const e = _entity(get())
  return e?.scope === 'workspace' ? workspacePersistence : podPersistence
}

function _activeEntityId(get: () => ViewStore): string {
  return get().activeEntityId ?? ''
}

function _persistView(get: () => ViewStore, views: PerViewState[], viewId: string) {
  const v = views.find((x) => x.id === viewId)
  if (v) _strategy(get).persistView(_activeEntityId(get), v)
}

function _debouncedPersistView(get: () => ViewStore, views: PerViewState[], viewId: string) {
  const v = views.find((x) => x.id === viewId)
  if (v) debouncedPersist(_strategy(get), _activeEntityId(get), v)
}

function _persistAllViews(get: () => ViewStore, views: PerViewState[]) {
  const strategy = _strategy(get)
  const entityId = _activeEntityId(get)
  for (const v of views) strategy.persistView(entityId, v)
}

type ViewPatch = Partial<PerViewState>
type ViewUpdater = (view: PerViewState, entity: ScopeState) => ViewPatch | null
type PersistMode = 'immediate' | 'debounced'

/**
 * Apply `updater` to a single view (resolved by `select`), write the result,
 * and persist that view. Returning `null` from the updater bails out without
 * touching the store — used for the per-mutator guards (wrong viewType, no
 * layout, no-op change). Collapses the find-replace-persist boilerplate shared
 * by every view mutator into one place.
 */
function updateOneView(
  get: () => ViewStore,
  set: (partial: Partial<ViewStore>) => void,
  select: (entity: ScopeState) => PerViewState | undefined,
  updater: ViewUpdater,
  persist: PersistMode,
) {
  const state = get()
  const p = _entity(state)
  if (!p) return
  const target = select(p)
  if (!target) return
  const patch = updater(target, p)
  if (!patch) return
  const views = p.views.map((v) => (v.id !== target.id ? v : { ...v, ...patch }))
  set(_setEntity(state, { views }))
  if (persist === 'debounced') _debouncedPersistView(get, views, target.id)
  else _persistView(get, views, target.id)
}

/** Update the active view of the active entity. See {@link updateOneView}. */
function updateActiveView(
  get: () => ViewStore,
  set: (partial: Partial<ViewStore>) => void,
  updater: ViewUpdater,
  persist: PersistMode = 'immediate',
) {
  updateOneView(get, set, (p) => findActiveView(p.views, p.activeViewId), updater, persist)
}

/** Update a view by id within the active entity. See {@link updateOneView}. */
function updateView(
  get: () => ViewStore,
  set: (partial: Partial<ViewStore>) => void,
  viewId: string,
  updater: ViewUpdater,
  persist: PersistMode = 'immediate',
) {
  updateOneView(get, set, (p) => p.views.find((v) => v.id === viewId), updater, persist)
}

function isOptimisticAgentSessionId(itemId: string): boolean {
  return itemId.startsWith('optimistic-agent-session-')
}

function replaceSplitNodeItemId(node: SplitNode | null, from: string, to: string): SplitNode | null {
  if (!node) return node
  if (node.type === 'leaf') return node.itemId === from ? { ...node, itemId: to } : node
  return {
    ...node,
    children: [
      replaceSplitNodeItemId(node.children[0], from, to) ?? node.children[0],
      replaceSplitNodeItemId(node.children[1], from, to) ?? node.children[1],
    ],
  }
}

function replaceViewItemId(view: PerViewState, from: string, to: string): PerViewState {
  const itemSettings = Object.fromEntries(
    Object.entries(view.itemSettings).map(([key, value]) => [key === from ? to : key, value]),
  )
  const paneTabs = view.paneTabs
    ? Object.fromEntries(
        Object.entries(view.paneTabs).map(([paneId, group]) => [
          paneId,
          {
            ...group,
            tabIds: group.tabIds.map((id) => (id === from ? to : id)),
            activeTabId: group.activeTabId === from ? to : group.activeTabId,
          },
        ]),
      )
    : view.paneTabs

  return {
    ...view,
    itemSettings,
    activeItemId: view.activeItemId === from ? to : view.activeItemId,
    focusedItemId: view.focusedItemId === from ? to : view.focusedItemId,
    layout: replaceSplitNodeItemId(view.layout, from, to),
    paneTabs,
    gridWidgets: view.gridWidgets?.map((w) => (w.itemId === from ? { ...w, itemId: to } : w)) ?? view.gridWidgets,
    carouselItems: view.carouselItems?.map((i) => (i.itemId === from ? { ...i, itemId: to } : i)) ?? view.carouselItems,
    columnsRows:
      view.columnsRows?.map((row) => ({
        ...row,
        items: row.items.map((i) => (i.itemId === from ? { ...i, itemId: to } : i)),
      })) ?? view.columnsRows,
    canvasNodes: view.canvasNodes?.map((n) => (n.itemId === from ? { ...n, itemId: to } : n)) ?? view.canvasNodes,
  }
}

export const useViewStore = create<ViewStore>()((set, get) => ({
  activeEntityId: null,
  entities: {},

  load: (entityId, dbViews, podItems, activeViewId, scope = 'pod') => {
    flushDebouncedPersist()
    const state = get()
    if (state.entities[entityId]) {
      set({ activeEntityId: entityId })
      return
    }
    const views = dbViews.map((v) => makeViewState(v, podItems))
    const active = views.find((v) => v.id === activeViewId) ?? views[0]
    set({
      activeEntityId: entityId,
      entities: { ...state.entities, [entityId]: { podItems, views, activeViewId: active?.id ?? null, scope } },
    })
  },

  /**
   * Re-derive per-view state from server data WITHOUT wiping the entity
   * (which `load` refuses to do once the entity is live). Used when
   * a paired invalidation delivers an updated `view.listByPod` and we
   * need the local canvas / columns / split-pane layout to pick up
   * items or node positions placed by another client. Preserves the
   * currently-selected active view when it still exists. Safe to call
   * on every re-fetch — it's a pure re-derivation from server state
   * merged with current podItems.
   */
  reconcileViewsFromServer: (entityId, dbViews) => {
    const state = get()
    const p = state.entities[entityId]
    if (!p) return
    // Preserve client-side focus across reconciles. The server's
    // `config.focusedItemId` lags behind by the persist debounce (and
    // historically wasn't persisted at all), so deferring to it would
    // wipe the user's just-clicked focus the next time TanStack Query
    // refetches `view.listByPod`. Only adopt the server's focus when
    // the local one no longer points at a valid item.
    const views = dbViews.map((v) => {
      const next = makeViewState(v, p.podItems)
      const prev = p.views.find((pv) => pv.id === v.id)
      if (!prev?.focusedItemId) return next
      const strategy = getStrategy(next)
      if (!strategy.containsItem(next, prev.focusedItemId, p.podItems)) return next
      return { ...next, focusedItemId: prev.focusedItemId, activeItemId: prev.focusedItemId }
    })
    const activeViewId = views.find((v) => v.id === p.activeViewId)?.id ?? views[0]?.id ?? null
    // Same idempotency guard as `reconcile`: this fires on every
    // `view.listByPod` refetch, so reuse unchanged view refs and skip the
    // write when nothing moved — otherwise the fresh references churn every
    // subscriber on each refetch.
    const nextViews = views.map((nv, i) => (deepEqual(nv, p.views[i]) ? (p.views[i] ?? nv) : nv))
    const viewsChanged = nextViews.length !== p.views.length || nextViews.some((nv, i) => nv !== p.views[i])
    if (!viewsChanged && activeViewId === p.activeViewId) return
    set({
      entities: {
        ...state.entities,
        [entityId]: { ...p, views: nextViews, activeViewId },
      },
    })
  },

  addView: async (entityId, name, viewType = 'split-pane') => {
    const state = get()
    const p = _entity(state)
    if (!p) return ''

    const activeView = findActiveView(p.views, p.activeViewId)
    let sourcePodItems = p.podItems
    if (activeView) {
      const viewItems = buildViewItems(p.podItems, activeView)
      const visibleIds = new Set(viewItems.map((vi) => vi.id))
      sourcePodItems = p.podItems.filter((pi) => visibleIds.has(pi.id))
    }

    const itemSettings: Record<string, ViewItemSettings> = {}
    for (const pi of sourcePodItems) {
      itemSettings[pi.id] = { sortOrder: pi.sortOrder }
    }

    let config:
      | SplitPaneViewConfig
      | GridViewConfig
      | CarouselViewConfig
      | ColumnsViewConfig
      | CanvasViewConfig
      | { type: 'tabs' }

    if (viewType === 'tabs') {
      config = { type: 'tabs' }
    } else if (viewType === 'canvas') {
      const nodes: CanvasNode[] = sourcePodItems.map((pi, i) => ({
        itemId: pi.id,
        x: (i % 3) * 640,
        y: Math.floor(i / 3) * 460,
        width: 600,
        height: 420,
      }))
      config = { type: 'canvas', nodes }
    } else if (viewType === 'carousel') {
      const items: CarouselItem[] = sourcePodItems.map((pi) => ({ itemId: pi.id, width: 520 }))
      config = { type: 'carousel', items }
    } else if (viewType === 'columns') {
      const byPod = new Map<string, { itemId: string; width: number }[]>()
      for (const pi of sourcePodItems) {
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
      config = { type: 'columns', rows }
    } else if (viewType === 'grid') {
      const widgets: GridWidget[] = sourcePodItems.map((pi, i) => ({
        itemId: pi.id,
        x: (i % 2) * 6,
        y: Math.floor(i / 2) * 4,
        w: 6,
        h: 4,
      }))
      config = { type: 'grid', widgets }
    } else {
      const firstItem = sourcePodItems[0]
      const layout: SplitNode | null = firstItem ? { type: 'leaf', itemId: firstItem.id } : null
      if (layout) {
        const paneTabs = buildPaneTabsFromLayout(layout)
        config = { type: 'split-pane', layout, paneTabs }
      } else {
        config = { type: 'tabs' }
      }
    }

    const created = await _strategy(get).createView(entityId, name, viewType, config, itemSettings)
    const viewState = makeViewState(
      { id: created.id, name: created.name, viewType, config, itemSettings: created.itemSettings ?? {} },
      sourcePodItems,
    )
    await _strategy(get).setActiveView(entityId, created.id)
    set(_setEntity(get(), { views: [...p.views, viewState], activeViewId: created.id }))
    return created.id
  },

  removeView: async (viewId, entityId) => {
    const state = get()
    const p = _entity(state)
    if (!p || p.views.length <= 1) return
    await _strategy(get).deleteView(entityId, viewId)
    const remaining = p.views.filter((v) => v.id !== viewId)
    const newActiveId = p.activeViewId === viewId ? (remaining[0]?.id ?? null) : p.activeViewId
    if (p.activeViewId === viewId) await _strategy(get).setActiveView(entityId, newActiveId)
    set(_setEntity(get(), { views: remaining, activeViewId: newActiveId }))
  },

  switchView: (viewId, entityId) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const currentView = findActiveView(p.views, p.activeViewId)
    const currentFocused = currentView?.focusedItemId

    if (currentFocused) {
      const targetView = p.views.find((v) => v.id === viewId)
      if (targetView) {
        const strategy = getStrategy(targetView)
        if (strategy.containsItem(targetView, currentFocused, p.podItems)) {
          const views = p.views.map((v) =>
            v.id === viewId ? { ...v, focusedItemId: currentFocused, activeItemId: currentFocused } : v,
          )
          set(_setEntity(state, { views, activeViewId: viewId }))
          _strategy(get)
            .setActiveView(entityId, viewId)
            .catch((err) => {
              console.warn('[view-store] setActiveView persist failed:', { entityId, viewId, err })
            })
          return
        }
      }
    }

    set(_setEntity(state, { activeViewId: viewId }))
    _strategy(get)
      .setActiveView(entityId, viewId)
      .catch((err) => {
        console.warn('[view-store] setActiveView persist failed:', { entityId, viewId, err })
      })
  },

  renameView: (viewId, name) => {
    updateView(get, set, viewId, () => ({ name }))
  },

  duplicateView: async (viewId, entityId) => {
    const state = get()
    const p = _entity(state)
    if (!p) return ''
    const source = p.views.find((v) => v.id === viewId)
    if (!source) return ''
    const itemSettings: Record<string, ViewItemSettings> = {}
    for (const [key, val] of Object.entries(source.itemSettings)) {
      itemSettings[key] = { sortOrder: val.sortOrder, ...(val.pinned ? { pinned: true } : {}) }
    }

    const strategy = getStrategy(source)
    const rawConfig = strategy.buildConfig(source)
    type ViewConfigUnion =
      | SplitPaneViewConfig
      | GridViewConfig
      | CarouselViewConfig
      | ColumnsViewConfig
      | CanvasViewConfig
      | { type: 'tabs' }
    const config: ViewConfigUnion | null = rawConfig ? (structuredClone(rawConfig) as ViewConfigUnion) : null

    const created = await _strategy(get).createView(
      entityId,
      `${source.name} (copy)`,
      source.viewType,
      config ?? { type: 'tabs' },
      itemSettings,
    )
    const viewState = makeViewState(
      {
        id: created.id,
        name: created.name,
        viewType: source.viewType,
        config,
        itemSettings: created.itemSettings ?? {},
      },
      p.podItems,
    )
    await _strategy(get).setActiveView(entityId, created.id)
    set(_setEntity(get(), { views: [...p.views, viewState], activeViewId: created.id }))
    return created.id
  },

  setActiveItem: (itemId) => {
    updateActiveView(
      get,
      set,
      (view) =>
        view.focusedItemId === itemId && view.activeItemId === itemId
          ? null
          : { activeItemId: itemId, focusedItemId: itemId },
      'debounced',
    )
  },

  moveItem: (fromIndex, toIndex) => {
    updateActiveView(get, set, (activeView, p) => {
      const items = buildViewItems(p.podItems, activeView)
      const ordered = [...items]
      const [moved] = ordered.splice(fromIndex, 1)
      if (!moved) return null
      ordered.splice(toIndex, 0, moved)

      const newSettings = { ...activeView.itemSettings }
      for (let i = 0; i < ordered.length; i++) {
        const item = ordered[i]
        if (!item) continue
        newSettings[item.id] = { ...newSettings[item.id], sortOrder: i }
      }
      return { itemSettings: newSettings }
    })
  },

  splitPane: (direction, newItemId) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const activeView = findActiveView(p.views, p.activeViewId)
    if (!activeView) return

    const views = p.views.map((v) => {
      const newSettings = { ...v.itemSettings }
      if (!newSettings[newItemId]) {
        const maxSort = Object.values(newSettings).reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1)
        newSettings[newItemId] = { sortOrder: maxSort + 1 }
      }
      const strategy = getStrategy(v)
      if (v.id === activeView.id) {
        const result = strategy.addItemToActiveView(v, newItemId, direction)
        return { ...v, ...result, itemSettings: newSettings }
      }
      const result = strategy.addItemToOtherView(v, newItemId)
      return { ...v, ...result, itemSettings: newSettings }
    })
    set(_setEntity(state, { views }))
    if (!isOptimisticAgentSessionId(newItemId)) _persistAllViews(get, views)
  },

  closeFocusedPane: () => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const activeView = findActiveView(p.views, p.activeViewId)
    if (!activeView?.focusedItemId) return
    if (
      activeView.viewType !== 'tabs' &&
      !activeView.layout &&
      !activeView.gridWidgets &&
      !activeView.carouselItems &&
      !activeView.columnsRows &&
      !activeView.canvasNodes
    )
      return
    get().deleteItem(activeView.focusedItemId)
  },

  focusPane: (itemId) => {
    updateActiveView(
      get,
      set,
      (view) =>
        view.focusedItemId === itemId && view.activeItemId === itemId
          ? null
          : { focusedItemId: itemId, activeItemId: itemId },
      'debounced',
    )
  },

  updatePaneSizes: (path, sizes) => {
    updateActiveView(
      get,
      set,
      (activeView) => (activeView.layout ? { layout: updateSizes(activeView.layout, path, sizes) } : null),
      'debounced',
    )
  },

  focusNextPane: () => {
    updateActiveView(
      get,
      set,
      (activeView, p) => {
        if (!activeView.focusedItemId) return null
        const strategy = getStrategy(activeView)
        let next: string | null
        if (activeView.viewType === 'tabs') {
          const items = buildViewItems(p.podItems, activeView)
          const idx = items.findIndex((i) => i.id === activeView.focusedItemId)
          next = idx >= 0 && idx < items.length - 1 ? (items[idx + 1]?.id ?? null) : null
        } else {
          next = strategy.getNextItemId(activeView, activeView.focusedItemId)
        }
        return next ? { focusedItemId: next, activeItemId: next } : null
      },
      'debounced',
    )
  },

  focusPrevPane: () => {
    updateActiveView(
      get,
      set,
      (activeView, p) => {
        if (!activeView.focusedItemId) return null
        const strategy = getStrategy(activeView)
        let prev: string | null
        if (activeView.viewType === 'tabs') {
          const items = buildViewItems(p.podItems, activeView)
          const idx = items.findIndex((i) => i.id === activeView.focusedItemId)
          prev = idx > 0 ? (items[idx - 1]?.id ?? null) : null
        } else {
          prev = strategy.getPrevItemId(activeView, activeView.focusedItemId)
        }
        return prev ? { focusedItemId: prev, activeItemId: prev } : null
      },
      'debounced',
    )
  },

  focusPaneByIndex: (index) => {
    updateActiveView(
      get,
      set,
      (activeView, p) => {
        const strategy = getStrategy(activeView)
        let target: string | null
        if (activeView.viewType === 'tabs') {
          const items = buildViewItems(p.podItems, activeView)
          target = items[index]?.id ?? null
        } else {
          target = strategy.getItemIdAtIndex(activeView, index)
        }
        return target ? { focusedItemId: target, activeItemId: target } : null
      },
      'debounced',
    )
  },

  swapPanes: (idA, idB) => {
    updateActiveView(get, set, (activeView) => {
      if (!activeView.layout) return null
      const newLayout = swapLeaves(activeView.layout, idA, idB)
      let newPaneTabs = activeView.paneTabs
      if (newPaneTabs) {
        newPaneTabs = { ...newPaneTabs }
        const groupA = newPaneTabs[idA]
        const groupB = newPaneTabs[idB]
        if (groupA && groupB) {
          newPaneTabs[idA] = groupB
          newPaneTabs[idB] = groupA
        }
      }
      return { layout: newLayout, paneTabs: newPaneTabs }
    })
  },

  addTabToPane: (paneId, itemId) => {
    updateActiveView(get, set, (activeView, p) => {
      const existingGroup = activeView.paneTabs?.[paneId]
      if (!activeView.paneTabs || !existingGroup) return null

      const newPaneTabs = { ...activeView.paneTabs }
      const group = { ...existingGroup }
      if (group.tabIds.includes(itemId)) {
        group.activeTabId = itemId
      } else {
        group.tabIds = [...group.tabIds, itemId]
        group.activeTabId = itemId
      }
      newPaneTabs[paneId] = group

      const newSettings = { ...activeView.itemSettings }
      if (!newSettings[itemId]) newSettings[itemId] = { sortOrder: p.podItems.length }

      return { paneTabs: newPaneTabs, focusedItemId: itemId, activeItemId: itemId, itemSettings: newSettings }
    })
  },

  removeTabFromPane: (paneId, itemId) => {
    updateActiveView(get, set, (activeView) => {
      const existingGroup = activeView.paneTabs?.[paneId]
      if (!activeView.paneTabs || !existingGroup || !activeView.layout) return null

      const newPaneTabs = { ...activeView.paneTabs }
      const group = { ...existingGroup }
      group.tabIds = group.tabIds.filter((id) => id !== itemId)

      let newLayout: SplitNode | null = activeView.layout
      if (group.tabIds.length === 0) {
        delete newPaneTabs[paneId]
        newLayout = removeLeaf(activeView.layout, paneId)
      } else {
        if (group.activeTabId === itemId) group.activeTabId = group.tabIds[0] ?? null
        newPaneTabs[paneId] = group
      }

      let newFocused: string | null = null
      if (newLayout && Object.keys(newPaneTabs).length > 0) {
        if (activeView.focusedItemId === itemId) {
          const pane = newPaneTabs[paneId]
          if (pane) {
            newFocused = pane.activeTabId
          } else {
            const firstPaneId = collectLeafIds(newLayout)[0]
            const firstPane = firstPaneId ? newPaneTabs[firstPaneId] : undefined
            newFocused = firstPane ? firstPane.activeTabId : null
          }
        } else {
          newFocused = activeView.focusedItemId
        }
      }

      return { layout: newLayout, paneTabs: newPaneTabs, focusedItemId: newFocused, activeItemId: newFocused }
    })
  },

  setActiveTabInPane: (paneId, itemId) => {
    updateActiveView(get, set, (activeView) => {
      const existingGroup = activeView.paneTabs?.[paneId]
      if (!activeView.paneTabs || !existingGroup) return null
      const newPaneTabs = { ...activeView.paneTabs }
      newPaneTabs[paneId] = { ...existingGroup, activeTabId: itemId }
      return { paneTabs: newPaneTabs, focusedItemId: itemId, activeItemId: itemId }
    })
  },

  focusTabByIndex: (index) => {
    const p = _entity(get())
    if (!p) return
    const activeView = findActiveView(p.views, p.activeViewId)
    if (!activeView) return
    const paneId =
      activeView.paneTabs && activeView.focusedItemId
        ? findPaneForItem(activeView.paneTabs, activeView.focusedItemId)
        : null
    if (!paneId) {
      get().focusPaneByIndex(index)
      return
    }
    updateActiveView(get, set, (view) => {
      const group = view.paneTabs?.[paneId]
      const targetTabId = group?.tabIds[index]
      if (!group || !targetTabId) return null
      const newPaneTabs = { ...view.paneTabs }
      newPaneTabs[paneId] = { ...group, activeTabId: targetTabId }
      return { paneTabs: newPaneTabs, focusedItemId: targetTabId, activeItemId: targetTabId }
    })
  },

  updateGridLayout: (widgets) => {
    updateActiveView(get, set, (activeView) => (activeView.viewType !== 'grid' ? null : { gridWidgets: widgets }))
  },

  addGridWidget: (itemId) => {
    updateActiveView(get, set, (activeView) => {
      if (activeView.viewType !== 'grid') return null
      const widgets = activeView.gridWidgets ? [...activeView.gridWidgets] : []
      if (widgets.some((w) => w.itemId === itemId)) return null
      const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0)
      widgets.push({ itemId, x: 0, y: maxY, w: 6, h: 4 })
      return { gridWidgets: widgets, focusedItemId: itemId, activeItemId: itemId }
    })
  },

  updateCarouselItems: (items) => {
    updateActiveView(get, set, (activeView) => (activeView.viewType !== 'carousel' ? null : { carouselItems: items }))
  },

  resizeCarouselItem: (itemId, width) => {
    updateActiveView(
      get,
      set,
      (activeView) => {
        if (activeView.viewType !== 'carousel' || !activeView.carouselItems) return null
        const items = activeView.carouselItems.map((i) => (i.itemId === itemId ? { ...i, width } : i))
        return { carouselItems: items }
      },
      'debounced',
    )
  },

  updateColumnsRows: (rows) => {
    updateActiveView(get, set, (activeView) => (activeView.viewType !== 'columns' ? null : { columnsRows: rows }))
  },

  resizeColumnsItem: (rowIndex, itemId, width) => {
    updateActiveView(
      get,
      set,
      (activeView) => {
        if (activeView.viewType !== 'columns' || !activeView.columnsRows) return null
        const rows = structuredClone(activeView.columnsRows)
        const row = rows[rowIndex]
        if (!row) return null
        const item = row.items.find((i) => i.itemId === itemId)
        if (item) item.width = width
        return { columnsRows: rows }
      },
      'debounced',
    )
  },

  addColumnsRow: () => {
    updateActiveView(get, set, (activeView) => {
      if (activeView.viewType !== 'columns') return null
      const rows = activeView.columnsRows ? [...activeView.columnsRows, { items: [] }] : [{ items: [] }]
      return { columnsRows: rows }
    })
  },

  removeColumnsRow: (rowIndex) => {
    updateActiveView(get, set, (activeView) => {
      if (activeView.viewType !== 'columns' || !activeView.columnsRows) return null
      const rows = activeView.columnsRows.filter((_, i) => i !== rowIndex)
      const allIds = columnsItemIds(rows)
      const newFocused =
        activeView.focusedItemId && allIds.includes(activeView.focusedItemId)
          ? activeView.focusedItemId
          : (allIds[0] ?? null)
      return { columnsRows: rows, focusedItemId: newFocused, activeItemId: newFocused }
    })
  },

  moveItemToRow: (itemId, targetRowIndex) => {
    updateActiveView(get, set, (activeView) => {
      if (activeView.viewType !== 'columns' || !activeView.columnsRows) return null
      const rows = structuredClone(activeView.columnsRows)
      let movedItem: { itemId: string; width: number } | null = null
      for (const row of rows) {
        const idx = row.items.findIndex((i) => i.itemId === itemId)
        if (idx >= 0) {
          movedItem = row.items.splice(idx, 1)[0] ?? null
          break
        }
      }
      if (!movedItem) return null
      while (rows.length <= targetRowIndex) rows.push({ items: [] })
      const targetRow = rows[targetRowIndex]
      if (!targetRow) return null
      targetRow.items.push(movedItem)
      const cleanedRows = rows.filter((r) => r.items.length > 0)
      if (cleanedRows.length === 0) cleanedRows.push({ items: [] })
      return { columnsRows: cleanedRows }
    })
  },

  updateCanvasNodes: (nodes) => {
    updateActiveView(get, set, (activeView) => (activeView.viewType !== 'canvas' ? null : { canvasNodes: nodes }))
  },

  updateCanvasNode: (itemId, updates) => {
    updateActiveView(get, set, (activeView) => {
      if (activeView.viewType !== 'canvas' || !activeView.canvasNodes) return null
      const nodes = activeView.canvasNodes.map((n) => (n.itemId === itemId ? { ...n, ...updates } : n))
      return { canvasNodes: nodes }
    })
  },

  updateCanvasViewport: (viewport, entityId) => {
    const state = get()
    const p = state.entities[entityId]
    if (!p) return
    const activeView = findActiveView(p.views, p.activeViewId)
    if (!activeView || activeView.viewType !== 'canvas') return
    const views = p.views.map((v) => (v.id !== activeView.id ? v : { ...v, canvasViewport: viewport }))
    set({ entities: { ...state.entities, [entityId]: { ...p, views } } })
    const updated = views.find((v) => v.id === activeView.id)
    if (updated) {
      const strategy = p.scope === 'workspace' ? workspacePersistence : podPersistence
      debouncedPersist(strategy, entityId, updated)
    }
  },

  updatePodItems: (items) => {
    set(_setEntity(get(), { podItems: items }))
  },

  replacePodItem: (temporaryItemId, item, items) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const serverItems = items?.filter((pi) => pi.id !== temporaryItemId)
    const nextItems = serverItems ?? p.podItems.map((pi) => (pi.id === temporaryItemId ? item : pi))
    const podItems = nextItems.some((pi) => pi.id === item.id)
      ? nextItems
      : [...nextItems.filter((pi) => pi.id !== temporaryItemId), item]
    const views = p.views.map((view) => replaceViewItemId(view, temporaryItemId, item.id))
    set(_setEntity(state, { podItems, views }))
    _persistAllViews(get, views)
  },

  updatePodItemConfig: (itemId, config) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const podItems = p.podItems.map((pi) => (pi.id === itemId ? { ...pi, config } : pi))
    set(_setEntity(state, { podItems }))
  },

  renamePodItem: (itemId, label) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const current = p.podItems.find((pi) => pi.id === itemId)
    if (!current) return
    if (current.label === label && current.labelSource === 'user') return
    const podItems = p.podItems.map((pi) => (pi.id === itemId ? { ...pi, label, labelSource: 'user' } : pi))
    set(_setEntity(state, { podItems }))
    orpcForPod(state.activeEntityId)
      .podItem.update({ id: itemId, label, labelSource: 'user' })
      .catch((err) => console.error('[view-store] podItem.update failed:', err))
  },

  autoRenamePodItem: (idOrPodTerminalId, label) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    let changed = false
    const podItems = p.podItems.map((pi) => {
      if (pi.labelSource === 'user') return pi
      const matches =
        (pi.contentType === 'terminal' &&
          (pi.config as { podTerminalId: string }).podTerminalId === idOrPodTerminalId) ||
        pi.id === idOrPodTerminalId
      if (!matches) return pi
      if (pi.label === label && pi.labelSource === 'terminal') return pi
      changed = true
      return { ...pi, label, labelSource: 'terminal' }
    })
    if (!changed) return
    set(_setEntity(state, { podItems }))
  },

  deleteItem: (itemId) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const newPodItems = p.podItems.filter((pi) => pi.id !== itemId)
    const views = p.views.map((v) => {
      const newSettings = { ...v.itemSettings }
      delete newSettings[itemId]
      const strategy = getStrategy(v)
      const result = strategy.removeItem(v, itemId, p.podItems)
      const { newFocusedItemId, ...rest } = result
      return {
        ...v,
        ...rest,
        itemSettings: newSettings,
        focusedItemId: newFocusedItemId,
        activeItemId: newFocusedItemId,
      }
    })
    set(_setEntity(state, { podItems: newPodItems, views }))
    _persistAllViews(get, views)
  },

  reconcile: (newPodItems) => {
    const state = get()
    const p = _entity(state)
    if (!p) return
    const newIds = new Set(newPodItems.map((pi) => pi.id))
    const views = p.views.map((v) => {
      const newSettings = { ...v.itemSettings }
      for (const key of Object.keys(newSettings)) {
        if (!newIds.has(key)) delete newSettings[key]
      }
      for (const pi of newPodItems) {
        if (!(pi.id in newSettings)) {
          const maxSort = Object.values(newSettings).reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1)
          newSettings[pi.id] = { sortOrder: maxSort + 1 }
        }
      }
      const strategy = getStrategy(v)
      const result = strategy.reconcile(v, newIds)
      const { newFocusedItemId, ...rest } = result

      // At workspace scope, add new items that aren't in any view layout yet
      let withNewItems = {
        ...v,
        ...rest,
        itemSettings: newSettings,
        focusedItemId: newFocusedItemId,
        activeItemId: newFocusedItemId,
      }
      if (p.scope === 'workspace') {
        const existingIds = new Set(strategy.getItemIds(withNewItems))
        const missing = newPodItems.filter((pi) => !existingIds.has(pi.id))

        if (withNewItems.viewType === 'columns' && missing.length > 0) {
          // Group by pod — one row per pod at workspace scope
          const rows: ColumnsRow[] = withNewItems.columnsRows ? structuredClone(withNewItems.columnsRows) : []
          const podIdByItem = new Map(newPodItems.map((pi) => [pi.id, pi.podId]))
          const podRowMap = new Map<string, number>()
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r]
            if (!row) continue
            for (const item of row.items) {
              const pid = podIdByItem.get(item.itemId)
              if (pid && !podRowMap.has(pid)) podRowMap.set(pid, r)
            }
          }
          for (const pi of missing) {
            const pid = pi.podId ?? ''
            let rowIdx = podRowMap.get(pid)
            if (rowIdx === undefined) {
              rows.push({ items: [] })
              rowIdx = rows.length - 1
              podRowMap.set(pid, rowIdx)
            }
            const targetRow = rows[rowIdx]
            if (!targetRow) continue
            targetRow.items.push({ itemId: pi.id, width: 520 })
          }
          withNewItems = {
            ...withNewItems,
            columnsRows: rows,
            focusedItemId: withNewItems.focusedItemId ?? missing[0]?.id ?? null,
            activeItemId: withNewItems.activeItemId ?? missing[0]?.id ?? null,
          }
        } else {
          for (const pi of missing) {
            const added = strategy.addItem(withNewItems, pi.id)
            withNewItems = { ...withNewItems, ...added }
          }
        }
      }

      return withNewItems
    })
    // Reuse the previous reference for any view that didn't materially
    // change so selector subscribers don't re-render, and bail out of the
    // write entirely when neither items nor views moved. reconcile runs on
    // every refetch (which yields fresh array references with identical
    // content), so an unconditional `set` here loops into React #185.
    const nextViews = views.map((nv, i) => (deepEqual(nv, p.views[i]) ? (p.views[i] ?? nv) : nv))
    const viewsChanged = nextViews.some((nv, i) => nv !== p.views[i])
    const podItemsChanged = !deepEqual(p.podItems, newPodItems)
    if (!viewsChanged && !podItemsChanged) return
    set(_setEntity(state, { podItems: podItemsChanged ? newPodItems : p.podItems, views: nextViews }))
    if (viewsChanged) _persistAllViews(get, nextViews)
  },

  clear: () => {
    flushDebouncedPersist()
    set({ activeEntityId: null, entities: {} })
  },
}))

export {
  useActiveCanvasNodeIndex,
  useActiveCanvasNodes,
  useActiveCanvasViewport,
  useActiveCarouselItems,
  useActiveColumnsRows,
  useActiveGridWidgets,
  useActiveItemId,
  useActivePaneIndex,
  useActivePaneTabGroup,
  useActiveView,
  useActiveViewId,
  useActiveViewItems,
  useActiveViewLayout,
  useActiveViewSelector,
  useEntitySelector,
  useEntitySelector as usePodSelector,
  useFocusedItemId,
  usePodItem,
  usePodItems,
  useViews,
} from './selectors'
