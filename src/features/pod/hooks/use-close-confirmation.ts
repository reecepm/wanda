import { create } from 'zustand'

interface PendingClose {
  label: string
  title?: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
}

interface CloseConfirmationState {
  pending: PendingClose | null
  setPending: (pending: PendingClose | null) => void
}

export const useCloseConfirmation = create<CloseConfirmationState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}))
