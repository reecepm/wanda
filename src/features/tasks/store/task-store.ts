import { create } from 'zustand'

interface TaskStore {
  activeViewId: string | null
  setActiveViewId: (id: string | null) => void

  selectedTaskId: string | null
  setSelectedTaskId: (id: string | null) => void

  quickFilter: string
  setQuickFilter: (q: string) => void
}

export const useTaskStore = create<TaskStore>((set) => ({
  activeViewId: null,
  setActiveViewId: (id) => set({ activeViewId: id }),

  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  quickFilter: '',
  setQuickFilter: (q) => set({ quickFilter: q }),
}))
