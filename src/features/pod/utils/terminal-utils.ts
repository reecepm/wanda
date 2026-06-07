import { type PodItem, useViewStore, type ViewItem } from '@/features/view'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'

/**
 * Create a new terminal, optionally start it, fetch updated pod items,
 * and return the new PodItem (or null if not found).
 *
 * Handles steps 1-4 of the create-terminal flow that all view components share.
 * The caller is responsible for the view-specific step 5 (e.g. splitPane, addTabToPane, etc.)
 * and calling onTerminalsChanged().
 *
 * When the terminal is started (isRunning), this also pre-sets the UI store's
 * `selectedId` to the new PTY instance id. This way, by the time the new pane
 * renders and `useTerminal` mounts the xterm, its `isSelected` selector already
 * returns true and the focus effect fires on mount — no waiting for the
 * `runningTerminals` refetch → `useFocusBridge` sync loop to catch up (which
 * races with the xterm mount and leaves new tabs unfocused).
 */
export async function createTerminal(
  podId: string,
  opts?: { isRunning?: boolean; count?: number },
): Promise<PodItem | null> {
  const terminalCount = opts?.count ?? 1
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const terminal = await client.pod.addTerminal({
    podId: realPodId,
    name: `Terminal ${terminalCount + 1}`,
  })
  let ptyInstanceId: string | null = null
  if (opts?.isRunning) {
    const started = await client.pod.startTerminal({ podTerminalId: terminal.id })
    ptyInstanceId = started?.ptyInstanceId ?? null
  }
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find(
    (pi) => (pi.config as { podTerminalId?: string } | null | undefined)?.podTerminalId === terminal.id,
  )
  if (newPodItem) {
    useViewStore.getState().updatePodItems(updatedItems)
    if (ptyInstanceId) {
      useUIStore.getState().setSelected(ptyInstanceId)
    }
    return newPodItem
  }
  return null
}

/**
 * Convert a PodItem to a ViewItem for passing to TabContent.
 *
 * Duplicated in 5+ view components — consolidated here.
 */
export function toViewItem(podItem: PodItem): ViewItem {
  return {
    id: podItem.id,
    contentType: podItem.contentType,
    label: podItem.label,
    labelSource: (podItem.labelSource ?? 'default') as 'default' | 'terminal' | 'user',
    config: podItem.config,
    sortOrder: podItem.sortOrder,
  }
}
