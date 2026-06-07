import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createSettingsPersistence } from '@/shared/store-persistence'

interface UIStore {
  selectedId: string | null
  setSelected: (id: string | null) => void

  activePodId: string | null
  setActivePodId: (id: string | null) => void

  /** Workspace ID when viewing a workspace-scoped view (null when on a pod view) */
  activeWorkspaceViewId: string | null
  setActiveWorkspaceViewId: (id: string | null) => void

  /** Most-recently-used pod IDs (most recent first), for Cmd+P ordering */
  recentPodIds: string[]

  inboxOpen: boolean
  setInboxOpen: (open: boolean) => void

  /** Attention mode: when on, the app auto-navigates to the head of the attention
   * queue whenever the head changes (resolved → next item, or new item arrives). */
  attentionMode: boolean
  setAttentionMode: (on: boolean) => void
  toggleAttentionMode: () => void

  /** Set of workspace IDs that are expanded in the sidebar. null = not yet restored (show all expanded). */
  expandedWorkspaces: Set<string> | null
  toggleWorkspaceExpanded: (workspaceId: string) => void
  ensureWorkspaceExpanded: (workspaceId: string) => void

  /** Whether the sidebar is collapsed (auto-show on hover) */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void

  terminalFontSizes: Record<string, number>
  setTerminalFontSize: (terminalId: string, size: number) => void

  /** Whether initial state has been restored from settings */
  restored: boolean
}

export const useUIStore = create<UIStore>()(
  subscribeWithSelector((set, get) => ({
    selectedId: null,
    setSelected: (id) => set({ selectedId: id }),

    activePodId: null,
    activeWorkspaceViewId: null,
    setActiveWorkspaceViewId: (id) =>
      set((state) => {
        const activePodId = id ? null : state.activePodId
        if (state.activeWorkspaceViewId === id && state.activePodId === activePodId) return state
        return { activeWorkspaceViewId: id, activePodId }
      }),
    setActivePodId: (id) => {
      set((state) => {
        if (!id) {
          if (state.activePodId === null) return state
          return { activePodId: null }
        }
        const recent = state.recentPodIds.filter((pid) => pid !== id)
        recent.unshift(id)
        const nextRecent = recent.slice(0, 50)
        if (state.activePodId === id && state.activeWorkspaceViewId === null && state.recentPodIds[0] === id) {
          return state
        }
        return { activePodId: id, activeWorkspaceViewId: null, recentPodIds: nextRecent }
      })
    },

    recentPodIds: [],

    inboxOpen: false,
    setInboxOpen: (open) => set({ inboxOpen: open }),

    attentionMode: false,
    setAttentionMode: (on) => set({ attentionMode: on }),
    toggleAttentionMode: () => set((s) => ({ attentionMode: !s.attentionMode })),

    expandedWorkspaces: null,
    toggleWorkspaceExpanded: (workspaceId) =>
      set((state) => {
        const current = state.expandedWorkspaces ?? new Set<string>()
        const next = new Set(current)
        if (next.has(workspaceId)) next.delete(workspaceId)
        else next.add(workspaceId)
        return { expandedWorkspaces: next }
      }),
    ensureWorkspaceExpanded: (workspaceId) =>
      set((state) => {
        const current = state.expandedWorkspaces
        if (current?.has(workspaceId)) return state
        const next = new Set(current ?? new Set<string>())
        next.add(workspaceId)
        return { expandedWorkspaces: next }
      }),

    sidebarCollapsed: false,
    setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    terminalFontSizes: {},
    setTerminalFontSize: (terminalId, size) =>
      set({ terminalFontSizes: { ...get().terminalFontSizes, [terminalId]: size } }),

    restored: false,
  })),
)

const { restore } = createSettingsPersistence(useUIStore, {
  keys: [
    {
      storeKey: 'activePodId',
      settingKey: 'ui.activePodId',
    },
    {
      storeKey: 'recentPodIds',
      settingKey: 'ui.recentPodIds',
      serialize: (v: string[]) => (v.length ? JSON.stringify(v) : null),
      deserialize: (v) => JSON.parse(v) as string[],
    },
    {
      storeKey: 'expandedWorkspaces',
      settingKey: 'ui.expandedWorkspaces',
      serialize: (v: Set<string> | null) => (v ? JSON.stringify([...v]) : null),
      deserialize: (v) => new Set(JSON.parse(v) as string[]),
    },
    {
      storeKey: 'sidebarCollapsed',
      settingKey: 'ui.sidebarCollapsed',
      serialize: (v: boolean) => (v ? 'true' : null),
      deserialize: (v) => v === 'true',
    },
    {
      storeKey: 'attentionMode',
      settingKey: 'ui.attentionMode',
      serialize: (v: boolean) => (v ? 'true' : null),
      deserialize: (v) => v === 'true',
    },
  ],
})

/** Restore persisted UI state from settings. Call once at app startup. */
export const restoreUIState = restore
