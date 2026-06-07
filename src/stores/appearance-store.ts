import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createSettingsPersistence } from '@/shared/store-persistence'

export const ACCENT_COLORS = {
  zinc: { label: 'Subtle', border: 'border-zinc-500', swatch: 'bg-zinc-500' },
  blue: { label: 'Blue', border: 'border-blue-500', swatch: 'bg-blue-500' },
  purple: { label: 'Purple', border: 'border-purple-500', swatch: 'bg-purple-500' },
  emerald: { label: 'Green', border: 'border-emerald-500', swatch: 'bg-emerald-500' },
  amber: { label: 'Amber', border: 'border-amber-500', swatch: 'bg-amber-500' },
  rose: { label: 'Rose', border: 'border-rose-500', swatch: 'bg-rose-500' },
  cyan: { label: 'Cyan', border: 'border-cyan-500', swatch: 'bg-cyan-500' },
} as const

export type AccentColor = keyof typeof ACCENT_COLORS

interface AppearanceStore {
  accentColor: AccentColor
  setAccentColor: (color: AccentColor) => void
  restored: boolean
}

export const useAppearanceStore = create<AppearanceStore>()(
  subscribeWithSelector((set) => ({
    accentColor: 'blue',
    setAccentColor: (color) => set({ accentColor: color }),
    restored: false,
  })),
)

const { restore } = createSettingsPersistence(useAppearanceStore, {
  keys: [
    {
      storeKey: 'accentColor',
      settingKey: 'appearance.accentColor',
      deserialize: (v) => (v in ACCENT_COLORS ? (v as AccentColor) : 'blue'),
    },
  ],
})

/** Hook that returns the border class for focused/unfocused terminal chrome. */
export function useFocusBorder() {
  const accentColor = useAppearanceStore((s) => s.accentColor)
  return ACCENT_COLORS[accentColor].border
}

/** Restore from settings. Call once at startup. */
export const restoreAppearance = restore
