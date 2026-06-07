import type { SplitNode } from '@/features/view/utils/split-tree'
import { collectLeafIds } from '@/features/view/utils/split-tree'
import type { PerViewState, PodItem, ViewItem } from '@/features/view/utils/view-strategies'
import type { CanvasNode, CarouselItem, ColumnsRow, GridWidget, PaneTabGroup } from '@/types/schema'
import { buildViewItems, getActiveEntityState, getActiveViewState } from './helpers'
import { type ScopeState, useViewStore } from './view-store'

export function useEntitySelector<T>(selector: (pod: ScopeState | undefined) => T): T {
  return useViewStore((s) => selector(getActiveEntityState(s)))
}

export function useActiveViewSelector<T>(selector: (view: PerViewState | undefined) => T): T {
  return useViewStore((s) => selector(getActiveViewState(s)))
}

const EMPTY_ITEMS: PodItem[] = []
const EMPTY_VIEWS: PerViewState[] = []
const EMPTY_CAROUSEL_ITEMS: CarouselItem[] = []
const EMPTY_COLUMNS_ROWS: ColumnsRow[] = []
const EMPTY_GRID_WIDGETS: GridWidget[] = []
const EMPTY_CANVAS_NODES: CanvasNode[] = []

export function usePodItems(): PodItem[] {
  return useEntitySelector((p) => p?.podItems ?? EMPTY_ITEMS)
}

export function useViews(): PerViewState[] {
  return useEntitySelector((p) => p?.views ?? EMPTY_VIEWS)
}

export function useActiveViewId(): string | null {
  return useEntitySelector((p) => p?.activeViewId ?? null)
}

export function useFocusedItemId(): string | null {
  return useActiveViewSelector((view) => view?.focusedItemId ?? null)
}

export function useActiveItemId(): string | null {
  return useActiveViewSelector((view) => view?.activeItemId ?? null)
}

export function useActiveViewLayout(): SplitNode | null {
  return useActiveViewSelector((view) => view?.layout ?? null)
}

export function useActiveCarouselItems(): CarouselItem[] {
  return useActiveViewSelector((view) => view?.carouselItems ?? EMPTY_CAROUSEL_ITEMS)
}

export function useActiveColumnsRows(): ColumnsRow[] {
  return useActiveViewSelector((view) => view?.columnsRows ?? EMPTY_COLUMNS_ROWS)
}

export function useActiveGridWidgets(): GridWidget[] {
  return useActiveViewSelector((view) => view?.gridWidgets ?? EMPTY_GRID_WIDGETS)
}

export function useActiveCanvasNodes(): CanvasNode[] {
  return useActiveViewSelector((view) => view?.canvasNodes ?? EMPTY_CANVAS_NODES)
}

export function useActiveCanvasViewport(): { x: number; y: number; zoom: number } | null {
  return useActiveViewSelector((view) => view?.canvasViewport ?? null)
}

export function useActivePaneTabGroup(paneId: string): PaneTabGroup | undefined {
  return useActiveViewSelector((view) => view?.paneTabs?.[paneId])
}

export function useActivePaneIndex(paneId: string): number {
  return useActiveViewSelector((view) => (view?.layout ? collectLeafIds(view.layout).indexOf(paneId) : -1))
}

export function useActiveCanvasNodeIndex(itemId: string): number {
  return useActiveViewSelector((view) => view?.canvasNodes?.findIndex((node) => node.itemId === itemId) ?? -1)
}

export function usePodItem(itemId: string | null): PodItem | undefined {
  return useEntitySelector((pod) => {
    if (!itemId) return undefined
    return pod?.podItems.find((pi) => pi.id === itemId)
  })
}

export function useActiveViewItems(): ViewItem[] {
  const podItems = usePodItems()
  const views = useViews()
  const activeViewId = useActiveViewId()

  const activeView = views.find((v) => v.id === activeViewId) ?? views[0]
  if (!activeView) return []

  return buildViewItems(podItems, activeView)
}

export function useActiveView(): PerViewState | undefined {
  return useActiveViewSelector((view) => view)
}
