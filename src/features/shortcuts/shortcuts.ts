import type { Hotkey } from '@tanstack/hotkeys'
import { matchesKeyboardEvent } from '@tanstack/hotkeys'

export type { Hotkey }

export type ShortcutAction =
  | 'app:command-palette'
  | 'grid:focus-1'
  | 'grid:focus-2'
  | 'grid:focus-3'
  | 'grid:focus-4'
  | 'grid:focus-5'
  | 'grid:focus-6'
  | 'grid:focus-7'
  | 'grid:focus-8'
  | 'grid:focus-9'
  | 'grid:next-pane'
  | 'grid:prev-pane'
  | 'grid:toggle-maximize'
  | 'tab:focus-1'
  | 'tab:focus-2'
  | 'tab:focus-3'
  | 'tab:focus-4'
  | 'tab:focus-5'
  | 'tab:focus-6'
  | 'tab:focus-7'
  | 'tab:focus-8'
  | 'tab:focus-9'
  | 'pane:split-horizontal'
  | 'pane:split-vertical'
  | 'pane:close'
  | 'pod:stop'
  | 'pod:restart'
  | 'pod:open-in-editor'
  | 'view:cycle-prev'
  | 'view:cycle-next'
  | 'pod:cycle-prev'
  | 'pod:cycle-next'
  | 'pod:new-in-workspace'
  | 'view:open-picker'
  | 'terminal:clear'

export interface ShortcutDefinition {
  action: ShortcutAction
  label: string
  defaultBinding: Hotkey
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { action: 'app:command-palette', label: 'Command palette', defaultBinding: 'Mod+P' },
  { action: 'grid:focus-1', label: 'Focus pane 1', defaultBinding: 'Ctrl+1' as Hotkey },
  { action: 'grid:focus-2', label: 'Focus pane 2', defaultBinding: 'Ctrl+2' as Hotkey },
  { action: 'grid:focus-3', label: 'Focus pane 3', defaultBinding: 'Ctrl+3' as Hotkey },
  { action: 'grid:focus-4', label: 'Focus pane 4', defaultBinding: 'Ctrl+4' as Hotkey },
  { action: 'grid:focus-5', label: 'Focus pane 5', defaultBinding: 'Ctrl+5' as Hotkey },
  { action: 'grid:focus-6', label: 'Focus pane 6', defaultBinding: 'Ctrl+6' as Hotkey },
  { action: 'grid:focus-7', label: 'Focus pane 7', defaultBinding: 'Ctrl+7' as Hotkey },
  { action: 'grid:focus-8', label: 'Focus pane 8', defaultBinding: 'Ctrl+8' as Hotkey },
  { action: 'grid:focus-9', label: 'Focus pane 9', defaultBinding: 'Ctrl+9' as Hotkey },
  { action: 'grid:next-pane', label: 'Next pane', defaultBinding: 'Mod+]' },
  { action: 'grid:prev-pane', label: 'Previous pane', defaultBinding: 'Mod+[' },
  { action: 'grid:toggle-maximize', label: 'Toggle maximize', defaultBinding: 'Mod+Shift+Enter' },
  { action: 'tab:focus-1', label: 'Focus tab 1', defaultBinding: 'Mod+1' },
  { action: 'tab:focus-2', label: 'Focus tab 2', defaultBinding: 'Mod+2' },
  { action: 'tab:focus-3', label: 'Focus tab 3', defaultBinding: 'Mod+3' },
  { action: 'tab:focus-4', label: 'Focus tab 4', defaultBinding: 'Mod+4' },
  { action: 'tab:focus-5', label: 'Focus tab 5', defaultBinding: 'Mod+5' },
  { action: 'tab:focus-6', label: 'Focus tab 6', defaultBinding: 'Mod+6' },
  { action: 'tab:focus-7', label: 'Focus tab 7', defaultBinding: 'Mod+7' },
  { action: 'tab:focus-8', label: 'Focus tab 8', defaultBinding: 'Mod+8' },
  { action: 'tab:focus-9', label: 'Focus tab 9', defaultBinding: 'Mod+9' },
  { action: 'pane:split-horizontal', label: 'Split right', defaultBinding: 'Mod+D' },
  { action: 'pane:split-vertical', label: 'Split down', defaultBinding: 'Mod+Shift+D' },
  { action: 'pane:close', label: 'Close pane', defaultBinding: 'Mod+W' },
  { action: 'pod:stop', label: 'Stop pod', defaultBinding: 'Mod+Shift+S' },
  { action: 'pod:restart', label: 'Restart pod', defaultBinding: 'Mod+Shift+R' },
  { action: 'pod:open-in-editor', label: 'Open in editor', defaultBinding: 'Mod+Shift+E' },
  { action: 'view:cycle-prev', label: 'Previous view', defaultBinding: 'Mod+Alt+ArrowLeft' },
  { action: 'view:cycle-next', label: 'Next view', defaultBinding: 'Mod+Alt+ArrowRight' },
  { action: 'pod:cycle-prev', label: 'Previous pod', defaultBinding: 'Mod+Alt+ArrowUp' },
  { action: 'pod:cycle-next', label: 'Next pod', defaultBinding: 'Mod+Alt+ArrowDown' },
  { action: 'pod:new-in-workspace', label: 'New pod in current workspace', defaultBinding: 'Mod+Shift+N' },
  { action: 'view:open-picker', label: 'Open item picker', defaultBinding: 'Mod+T' },
  { action: 'terminal:clear', label: 'Clear terminal', defaultBinding: 'Mod+K' },
]

/** Get the active binding for an action, respecting overrides. */
export function getBinding(action: ShortcutAction, overrides: Record<string, string>): Hotkey {
  const def = DEFAULT_SHORTCUTS.find((d) => d.action === action)
  return (overrides[action] ?? def?.defaultBinding ?? '') as Hotkey
}

/** Build a map from binding string → action for all shortcuts. */
export function buildActionMap(overrides: Record<string, string>): Map<string, ShortcutAction> {
  const map = new Map<string, ShortcutAction>()
  for (const def of DEFAULT_SHORTCUTS) {
    const binding = overrides[def.action] ?? def.defaultBinding
    map.set(binding, def.action)
  }
  return map
}

/** Check if a keyboard event matches any registered app shortcut. */
export function isAppShortcut(event: KeyboardEvent, overrides: Record<string, string>): boolean {
  for (const def of DEFAULT_SHORTCUTS) {
    const binding = (overrides[def.action] ?? def.defaultBinding) as Hotkey
    if (matchesKeyboardEvent(event, binding)) return true
  }
  return false
}

/** Match a keyboard event against all registered shortcuts, returning the action if matched. */
export function matchShortcutEvent(event: KeyboardEvent, overrides: Record<string, string>): ShortcutAction | null {
  for (const def of DEFAULT_SHORTCUTS) {
    const binding = (overrides[def.action] ?? def.defaultBinding) as Hotkey
    if (matchesKeyboardEvent(event, binding)) return def.action
  }
  return null
}

export function getFocusIndex(action: ShortcutAction): number | null {
  const match = action.match(/^grid:focus-(\d)$/)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}

export function getTabFocusIndex(action: ShortcutAction): number | null {
  const match = action.match(/^tab:focus-(\d)$/)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}
