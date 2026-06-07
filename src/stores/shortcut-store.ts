import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createSettingsPersistence } from '@/shared/store-persistence'

interface ShortcutStore {
  overrides: Record<string, string>
  maximizedId: string | null
  restored: boolean

  setOverride: (action: string, binding: string) => void
  removeOverride: (action: string) => void
  setMaximized: (id: string | null) => void
  toggleMaximized: (id: string) => void
}

export const useShortcutStore = create<ShortcutStore>()(
  subscribeWithSelector((set, get) => ({
    overrides: {},
    maximizedId: null,
    restored: false,

    setOverride: (action, binding) => {
      const overrides = { ...get().overrides, [action]: binding }
      set({ overrides })
    },

    removeOverride: (action) => {
      const { [action]: _, ...rest } = get().overrides
      set({ overrides: rest })
    },

    setMaximized: (id) => set({ maximizedId: id }),

    toggleMaximized: (id) => {
      set({ maximizedId: get().maximizedId === id ? null : id })
    },
  })),
)

const { restore } = createSettingsPersistence(useShortcutStore, {
  keys: [
    {
      storeKey: 'overrides',
      settingKey: 'ui.shortcutOverrides',
      serialize: (v: Record<string, string>) => (Object.keys(v).length > 0 ? JSON.stringify(v) : null),
      deserialize: (v) => JSON.parse(v) as Record<string, string>,
    },
  ],
})

/** Restore persisted shortcut overrides from settings. Call once at app startup. */
export const restoreShortcuts = restore
