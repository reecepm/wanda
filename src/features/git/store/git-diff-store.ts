import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { createSettingsPersistence } from '@/shared/store-persistence'

export const DIFF_THEMES = {
  'pierre-dark': 'Pierre Dark',
  'github-dark': 'GitHub Dark',
  'one-dark-pro': 'One Dark Pro',
  dracula: 'Dracula',
  nord: 'Nord',
  'vitesse-dark': 'Vitesse Dark',
  'tokyo-night': 'Tokyo Night',
} as const

export type DiffTheme = keyof typeof DIFF_THEMES
export type DiffStyle = 'unified' | 'split'
export type SidebarSize = 'compact' | 'normal' | 'wide'

const SIDEBAR_WIDTHS: Record<SidebarSize, number> = {
  compact: 180,
  normal: 256,
  wide: 340,
}

export function getSidebarWidth(size: SidebarSize): number {
  return SIDEBAR_WIDTHS[size]
}

const FONT_SIZE_MIN = 10
const FONT_SIZE_MAX = 20
const FONT_SIZE_DEFAULT = 13

function clampFontSize(n: number): number {
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, n))
}

interface GitDiffStore {
  diffStyle: DiffStyle
  setDiffStyle: (style: DiffStyle) => void
  fontSize: number
  setFontSize: (size: number) => void
  theme: DiffTheme
  setTheme: (theme: DiffTheme) => void
  sidebarSize: SidebarSize
  setSidebarSize: (size: SidebarSize) => void
  restored: boolean
}

export const useGitDiffStore = create<GitDiffStore>()(
  subscribeWithSelector((set) => ({
    diffStyle: 'unified',
    setDiffStyle: (diffStyle) => set({ diffStyle }),
    fontSize: FONT_SIZE_DEFAULT,
    setFontSize: (size) => set({ fontSize: clampFontSize(size) }),
    theme: 'pierre-dark',
    setTheme: (theme) => set({ theme }),
    sidebarSize: 'compact',
    setSidebarSize: (sidebarSize) => set({ sidebarSize }),
    restored: false,
  })),
)

const { restore } = createSettingsPersistence(useGitDiffStore, {
  keys: [
    {
      storeKey: 'diffStyle',
      settingKey: 'git.diffStyle',
      deserialize: (v) => (v === 'split' ? 'split' : 'unified'),
    },
    {
      storeKey: 'fontSize',
      settingKey: 'git.fontSize',
      serialize: (v: number) => String(v),
      deserialize: (v) => clampFontSize(Number.parseInt(v, 10)) || FONT_SIZE_DEFAULT,
    },
    {
      storeKey: 'theme',
      settingKey: 'git.theme',
      deserialize: (v) => (v in DIFF_THEMES ? (v as DiffTheme) : 'pierre-dark'),
    },
    {
      storeKey: 'sidebarSize',
      settingKey: 'git.sidebarSize',
      deserialize: (v) => (v in SIDEBAR_WIDTHS ? (v as SidebarSize) : 'compact'),
    },
  ],
})

export const restoreGitDiffSettings = restore
