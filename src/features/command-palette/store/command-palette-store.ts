import { create } from 'zustand'

interface CommandPaletteStore {
  open: boolean
  toggle: () => void
  close: () => void
}

export const useCommandPalette = create<CommandPaletteStore>()((set, get) => ({
  open: false,
  toggle: () => set({ open: !get().open }),
  close: () => set({ open: false }),
}))
