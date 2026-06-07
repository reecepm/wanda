import { create } from 'zustand'

// Tracks per-pod, per-file UI state for diff viewers.
//
// "viewed" is persisted server-side against a content hash (see
// git.toggleFileViewed / git.listViewedFiles) — this store only mirrors it
// locally for fast reads. Mutations flow through TanStack Query / useToggleFileViewed.
//
// "collapsed" is ephemeral session state. Marking viewed auto-collapses; the
// user can still toggle collapsed independently via the chevron.

interface FileStateStore {
  viewed: Set<string>
  collapsed: Set<string>
  isViewed: (podId: string, filePath: string) => boolean
  isCollapsed: (podId: string, filePath: string) => boolean
  /** Replace the viewed set for a pod with the given file paths. */
  setViewedForPod: (podId: string, filePaths: string[]) => void
  /** Mark a single file viewed or not viewed locally (called after server mutation). */
  setViewedLocal: (podId: string, filePath: string, viewed: boolean) => void
  toggleCollapsed: (podId: string, filePath: string) => void
  setCollapsed: (podId: string, filePath: string, collapsed: boolean) => void
  clearAllForPod: (podId: string) => void
  getViewedCountForPod: (podId: string) => number
}

function key(podId: string, filePath: string): string {
  return `${podId}:${filePath}`
}

function withKey(set: Set<string>, k: string, present: boolean): Set<string> {
  const next = new Set(set)
  if (present) next.add(k)
  else next.delete(k)
  return next
}

function clearPodKeys(set: Set<string>, podId: string): Set<string> {
  const prefix = `${podId}:`
  const next = new Set<string>()
  for (const k of set) {
    if (!k.startsWith(prefix)) next.add(k)
  }
  return next
}

export const useViewedFilesStore = create<FileStateStore>()((set, get) => ({
  viewed: new Set(),
  collapsed: new Set(),

  isViewed: (podId, filePath) => get().viewed.has(key(podId, filePath)),
  isCollapsed: (podId, filePath) => get().collapsed.has(key(podId, filePath)),

  setViewedForPod: (podId, filePaths) =>
    set((state) => {
      const nextViewed = clearPodKeys(state.viewed, podId)
      // Also sync collapsed: anything newly-viewed should be collapsed,
      // anything that was viewed but isn't anymore should be expanded.
      // We only touch collapsed keys the server tells us about — other
      // collapsed state (user-driven) stays intact.
      let nextCollapsed = state.collapsed
      const incoming = new Set(filePaths.map((p) => key(podId, p)))
      for (const k of incoming) {
        nextViewed.add(k)
        nextCollapsed = withKey(nextCollapsed, k, true)
      }
      // Expand files that were previously viewed for this pod but are no longer.
      const prefix = `${podId}:`
      for (const k of state.viewed) {
        if (k.startsWith(prefix) && !incoming.has(k)) {
          nextCollapsed = withKey(nextCollapsed, k, false)
        }
      }
      return { viewed: nextViewed, collapsed: nextCollapsed }
    }),

  setViewedLocal: (podId, filePath, viewed) =>
    set((state) => {
      const k = key(podId, filePath)
      return {
        viewed: withKey(state.viewed, k, viewed),
        // Marking viewed → also collapse. Unmarking → also expand.
        collapsed: withKey(state.collapsed, k, viewed),
      }
    }),

  toggleCollapsed: (podId, filePath) =>
    set((state) => {
      const k = key(podId, filePath)
      return { collapsed: withKey(state.collapsed, k, !state.collapsed.has(k)) }
    }),

  setCollapsed: (podId, filePath, collapsed) =>
    set((state) => {
      const k = key(podId, filePath)
      if (state.collapsed.has(k) === collapsed) return state
      return { collapsed: withKey(state.collapsed, k, collapsed) }
    }),

  clearAllForPod: (podId) =>
    set((state) => ({
      viewed: clearPodKeys(state.viewed, podId),
      collapsed: clearPodKeys(state.collapsed, podId),
    })),

  getViewedCountForPod: (podId) => {
    const prefix = `${podId}:`
    let count = 0
    for (const k of get().viewed) {
      if (k.startsWith(prefix)) count++
    }
    return count
  },
}))
