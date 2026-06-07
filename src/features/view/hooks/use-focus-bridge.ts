import { useEffect } from 'react'
import { usePodItem } from '@/features/view/store/view-store'
import { useUIStore } from '@/stores/ui-store'
import type { RunningTerminal } from '@/types/terminal'

/**
 * Syncs the focused/active item from the view store to the UI store's selected terminal.
 *
 * Fires on every render (including first mount) so that mounting a view with a
 * pre-existing focused item — pod switch, app launch, view-type switch — pushes
 * the focus down to xterm. The `ui.selectedId !== selectedTerminalId` guard
 * prevents redundant writes.
 */
export function useFocusBridge(itemId: string | null, runningTerminals: RunningTerminal[]) {
  const podItem = usePodItem(itemId)

  const podTerminalId =
    podItem?.contentType === 'terminal' || podItem?.contentType === 'agent'
      ? (podItem.config as { podTerminalId: string }).podTerminalId
      : null
  const selectedTerminalId =
    podTerminalId != null
      ? (runningTerminals.find((t) => t.podTerminalId === podTerminalId)?.ptyInstanceId ?? null)
      : null

  useEffect(() => {
    if (!selectedTerminalId) return
    const ui = useUIStore.getState()
    if (ui.selectedId !== selectedTerminalId) {
      ui.setSelected(selectedTerminalId)
    }
  })
}
