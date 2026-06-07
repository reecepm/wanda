import { create } from 'zustand'

export type PickerMode = 'root' | 'agent' | 'command' | 'select-pod' | 'resume-session'

/** Pending action that needs a pod selection before executing. */
export type PendingPodAction =
  | { type: 'terminal' }
  | { type: 'browser' }
  | { type: 'markdown' }
  | { type: 'agent'; agentType: string }
  | { type: 'agent-session'; providerId: string }
  | { type: 'command'; commandId: string }
  | { type: 'new-command' }

interface ItemPickerState {
  open: boolean
  mode: PickerMode
  /** Action waiting for pod selection (workspace scope only) */
  pendingPodAction: PendingPodAction | null
  openPicker: () => void
  closePicker: () => void
  setMode: (mode: PickerMode) => void
  setPendingPodAction: (action: PendingPodAction) => void
}

export const useItemPicker = create<ItemPickerState>()((set) => ({
  open: false,
  mode: 'root',
  pendingPodAction: null,
  openPicker: () => set({ open: true, mode: 'root', pendingPodAction: null }),
  closePicker: () => set({ open: false, mode: 'root', pendingPodAction: null }),
  setMode: (mode) => set({ mode }),
  setPendingPodAction: (action) => set({ pendingPodAction: action, mode: 'select-pod' }),
}))
