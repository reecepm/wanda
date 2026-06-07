import type { Hotkey } from '@tanstack/hotkeys'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useEffect } from 'react'
import { useCommandPalette } from '@/features/command-palette'
import {
  buildActionMap,
  DEFAULT_SHORTCUTS,
  getBinding,
  getFocusIndex,
  getTabFocusIndex,
  type ShortcutAction,
} from '@/features/shortcuts/shortcuts'
import { terminalRegistry } from '@/features/terminal'
import { type PodItem, useItemPicker, useViewStore } from '@/features/view'
import { onShortcutForward } from '@/shared/app-bridge'
import { useShortcutStore } from '@/stores/shortcut-store'
import { useUIStore } from '@/stores/ui-store'

// Callback for creating + splitting (set by the component that owns the oRPC calls)
let splitCallback: ((direction: 'horizontal' | 'vertical') => void) | null = null

export function setSplitCallback(cb: ((direction: 'horizontal' | 'vertical') => void) | null) {
  splitCallback = cb
}

// Callback for server-side cleanup after closing a pane
export type CloseInfo = { podItem: PodItem }
let closeCallback: ((info: CloseInfo) => void) | null = null

export function setCloseCallback(cb: ((info: CloseInfo) => void) | null) {
  closeCallback = cb
}

// Callback for pod actions (stop, restart, open-in-editor)
export type PodAction = 'stop' | 'restart' | 'open-in-editor'
let podActionCallback: ((action: PodAction) => void) | null = null

export function setPodActionCallback(cb: ((action: PodAction) => void) | null) {
  podActionCallback = cb
}

// Callback for cycling pods within the current workspace (registered by WorkspaceExplorer)
let podCycleCallback: ((direction: 'prev' | 'next') => void) | null = null

export function setPodCycleCallback(cb: ((direction: 'prev' | 'next') => void) | null) {
  podCycleCallback = cb
}

// Callback for creating a new pod in the current workspace (registered by WorkspaceExplorer)
let newPodCallback: (() => void) | null = null

export function setNewPodCallback(cb: (() => void) | null) {
  newPodCallback = cb
}

function dispatchAction(action: ShortcutAction) {
  // Command palette (works globally, not just when a pod is open)
  if (action === 'app:command-palette') {
    useCommandPalette.getState().toggle()
    return
  }

  // Workspace-level actions — valid on both pod and workspace views
  if (action === 'pod:cycle-prev') {
    podCycleCallback?.('prev')
    return
  }
  if (action === 'pod:cycle-next') {
    podCycleCallback?.('next')
    return
  }
  if (action === 'pod:new-in-workspace') {
    newPodCallback?.()
    return
  }
  if (action === 'view:open-picker') {
    useItemPicker.getState().openPicker()
    return
  }

  // Clear the focused terminal's scrollback. Falls through silently if
  // the focused pane isn't a terminal (e.g. browser, agent log).
  if (action === 'terminal:clear') {
    const selectedId = useUIStore.getState().selectedId
    if (selectedId && terminalRegistry.has(selectedId)) {
      void terminalRegistry.clear(selectedId)
    }
    return
  }

  const store = useViewStore.getState()
  const pod = store.activeEntityId ? store.entities[store.activeEntityId] : undefined
  if (!pod) return
  const activeView = pod.views.find((v) => v.id === pod.activeViewId) ?? pod.views[0]
  if (!activeView) return

  // Focus pane by index (Ctrl+1..9)
  const focusIdx = getFocusIndex(action)
  if (focusIdx !== null) {
    store.focusPaneByIndex(focusIdx - 1)
    return
  }

  // Focus tab by index within focused pane (Cmd+1..9)
  const tabIdx = getTabFocusIndex(action)
  if (tabIdx !== null) {
    store.focusTabByIndex(tabIdx - 1)
    return
  }

  // Next/prev pane cycling
  if (action === 'grid:next-pane') {
    store.focusNextPane()
    return
  }
  if (action === 'grid:prev-pane') {
    store.focusPrevPane()
    return
  }

  // Cycle views within the current entity (pod or workspace view)
  if (action === 'view:cycle-prev' || action === 'view:cycle-next') {
    const views = pod.views
    if (views.length < 2 || !store.activeEntityId) return
    const currentIdx = views.findIndex((v) => v.id === activeView.id)
    if (currentIdx < 0) return
    const nextIdx =
      action === 'view:cycle-next' ? (currentIdx + 1) % views.length : (currentIdx - 1 + views.length) % views.length
    const nextView = views[nextIdx]
    if (nextView) store.switchView(nextView.id, store.activeEntityId)
    return
  }

  // Split pane actions
  if (action === 'pane:split-horizontal') {
    splitCallback?.('horizontal')
    return
  }
  if (action === 'pane:split-vertical') {
    splitCallback?.('vertical')
    return
  }

  // Close pane — delegates to callback which handles confirmation for running agents
  if (action === 'pane:close') {
    const closeView = pod.views.find((v) => v.id === pod.activeViewId)
    if (!closeView) return
    const focusedItemId = closeView.focusedItemId
    const podItem = focusedItemId ? pod.podItems.find((pi) => pi.id === focusedItemId) : null
    if (podItem) {
      closeCallback?.({ podItem })
    }
    return
  }

  // Pod actions
  if (action === 'pod:stop') {
    podActionCallback?.('stop')
    return
  }
  if (action === 'pod:restart') {
    podActionCallback?.('restart')
    return
  }
  if (action === 'pod:open-in-editor') {
    podActionCallback?.('open-in-editor')
    return
  }
}

function useShortcutAction(action: ShortcutAction, skip = false) {
  const overrides = useShortcutStore((s) => s.overrides)
  const binding = skip ? ('' as Hotkey) : getBinding(action, overrides)

  useHotkey(binding, (event) => {
    event.preventDefault()
    dispatchAction(action)
  })
}

// Actions registered globally in AppLayout — skipped here to avoid double-fire
const GLOBAL_ACTIONS = new Set<ShortcutAction>(['app:command-palette'])

export function useShortcuts() {
  // Register a useHotkey for each shortcut action
  /* eslint-disable react-hooks/rules-of-hooks -- DEFAULT_SHORTCUTS is a static registry. */
  for (const def of DEFAULT_SHORTCUTS) {
    // biome-ignore lint/correctness/useHookAtTopLevel: shortcuts array is static
    useShortcutAction(def.action, GLOBAL_ACTIONS.has(def.action))
  }
  /* eslint-enable react-hooks/rules-of-hooks */

  // Handle forwarded shortcuts from main process (keys Electron intercepts natively)
  useEffect(() => {
    const removeListener = onShortcutForward((binding, shift, alt) => {
      let fullBinding = binding
      if (alt) fullBinding = fullBinding.replace('Mod+', 'Mod+Alt+')
      if (shift) fullBinding = fullBinding.replace('Mod+', 'Mod+Shift+')
      const { overrides } = useShortcutStore.getState()
      const actionMap = buildActionMap(overrides)
      // Try exact match first, then fall back to non-shift variant
      // (e.g. Cmd+Shift+[ falls back to Cmd+[ for prev-tab — matches Ghostty/iTerm)
      const action = actionMap.get(fullBinding) ?? (shift ? actionMap.get(binding) : undefined)
      if (action) {
        dispatchAction(action)
      }
    })

    return () => {
      removeListener()
    }
  }, [])
}
