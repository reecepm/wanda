import { create } from 'zustand'

interface ViewCallbacks {
  /** Canvas-aware item placement callback. Set by canvas-view, consumed by pod-page picker. */
  viewPlaceItem: ((itemId: string) => void) | null
  setViewPlaceItem: (fn: ((itemId: string) => void) | null) => void

  /** Pan-to-node callback. Set by canvas-view, consumed by workspace-explorer. */
  canvasPanToNode: ((itemId: string) => void) | null
  setCanvasPanToNode: (fn: ((itemId: string) => void) | null) => void
}

export const useViewCallbacks = create<ViewCallbacks>((set) => ({
  viewPlaceItem: null,
  setViewPlaceItem: (fn) => set({ viewPlaceItem: fn }),
  canvasPanToNode: null,
  setCanvasPanToNode: (fn) => set({ canvasPanToNode: fn }),
}))

/** Convenience: pan to a canvas node (no-op if canvas isn't active) */
export function panToCanvasNode(itemId: string) {
  useViewCallbacks.getState().canvasPanToNode?.(itemId)
}
