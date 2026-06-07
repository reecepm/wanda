import {
  buildPaneTabsFromLayout,
  type PerViewState,
  type PodItem,
  type ViewItem,
  type ViewType,
  type ViewTypeStrategy,
  viewStrategies,
} from '@/features/view/utils/view-strategies'
import type { ColumnsRow } from '@/types/schema'
import type { ScopeState, ViewStore } from './view-store'

export { buildPaneTabsFromLayout }

export function columnsItemIds(rows: ColumnsRow[]): string[] {
  return rows.flatMap((r) => r.items.map((i) => i.itemId))
}

/**
 * Structural equality for the plain-data shapes stored in the view store
 * (PodItem, PerViewState, their nested config blobs). Used to gate store
 * writes: reconcile actions run on every TanStack Query refetch, and an
 * unconditional `set()` emits new array references even when the content
 * is identical — which re-renders every store subscriber and, when paired
 * with the effects that drive reconcile, spins into React error #185
 * (max update depth). Bailing out when nothing changed breaks that loop.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr && bArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) return false
    if (!deepEqual(aObj[key], bObj[key])) return false
  }
  return true
}

export function buildViewItems(podItems: PodItem[], viewState: PerViewState): ViewItem[] {
  const strategy = viewStrategies[viewState.viewType as ViewType]
  if (strategy) return strategy.buildViewItems(viewState, podItems)
  return []
}

export function findActiveView(views: PerViewState[], activeViewId: string | null): PerViewState | undefined {
  return views.find((v) => v.id === activeViewId) ?? views[0]
}

export function getStrategy(view: PerViewState): ViewTypeStrategy {
  return viewStrategies[view.viewType as ViewType]
}

export function getActiveEntityState(state: ViewStore): ScopeState | undefined {
  return state.activeEntityId ? state.entities[state.activeEntityId] : undefined
}

export function getActiveViewState(state: ViewStore): PerViewState | undefined {
  const pod = getActiveEntityState(state)
  if (!pod) return undefined
  return findActiveView(pod.views, pod.activeViewId)
}

export function _entity(state: ViewStore): ScopeState | undefined {
  return state.activeEntityId ? state.entities[state.activeEntityId] : undefined
}

export function _setEntity(state: ViewStore, update: Partial<ScopeState>): Partial<ViewStore> {
  if (!state.activeEntityId) return {}
  const existing = state.entities[state.activeEntityId]
  if (!existing) return {}
  return {
    entities: {
      ...state.entities,
      [state.activeEntityId]: { ...existing, ...update },
    },
  }
}
