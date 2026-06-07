import { useCloseConfirmation } from '@/features/pod/hooks/use-close-confirmation'
import { type PodItem, useViewStore } from '@/features/view'
import { orpcForPod } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import type { RunningTerminal } from '@/types/terminal'

export interface DeleteCallbacks {
  onTerminalRemoved: (podTerminalId: string) => void
  onItemsChanged: () => void
}

/**
 * Server-side cleanup after an item has already been removed from the store.
 * Used by keyboard shortcut path where closeFocusedPane already called deleteItem.
 */
export async function cleanupDeletedItem(podItem: PodItem, callbacks: DeleteCallbacks): Promise<void> {
  // Resolve which server owns this pod so remote pods' items are
  // deleted on the REMOTE server, not accidentally on the local one.
  const activeEntityId = useViewStore.getState().activeEntityId
  const client = orpcForPod(activeEntityId)
  if (podItem.contentType === 'terminal') {
    const podTerminalId = (podItem.config as { podTerminalId: string }).podTerminalId
    callbacks.onTerminalRemoved(podTerminalId)
    await client.pod.removeTerminal({ id: podTerminalId })
  } else if (podItem.contentType === 'agent') {
    const podAgentId = (podItem.config as { podAgentId: string }).podAgentId
    const podTerminalId = (podItem.config as { podTerminalId: string }).podTerminalId
    callbacks.onTerminalRemoved(podTerminalId)
    await client.pod.removeAgent({ podAgentId })
  } else if (podItem.contentType === 'command') {
    // For commands, just remove the pod item — keep the command config
    await client.podItem.delete({ id: podItem.id })
  } else {
    await client.podItem.delete({ id: podItem.id })
  }
  callbacks.onItemsChanged()
}

/**
 * Full item deletion: removes from store (all views) + server-side cleanup.
 * Used by X buttons and context menu "Delete" actions.
 */
export async function deleteItemWithCleanup(podItem: PodItem, callbacks: DeleteCallbacks): Promise<void> {
  useViewStore.getState().deleteItem(podItem.id)
  await cleanupDeletedItem(podItem, callbacks)
}

/**
 * Request to close an item. Running terminal-backed agents and chat-based
 * agent sessions require confirmation before being removed from the view.
 */
export function requestItemClose(
  podItem: PodItem,
  runningTerminals: { podTerminalId: string }[],
  callbacks: DeleteCallbacks,
): void {
  if (podItem.contentType === 'agent-session') {
    useCloseConfirmation.getState().setPending({
      label: podItem.label ?? 'Agent',
      title: 'Close agent chat?',
      description: `"${podItem.label ?? 'Agent'}" will be removed from this view. The saved session can be resumed later.`,
      confirmLabel: 'Close Chat',
      onConfirm: () => {
        deleteItemWithCleanup(podItem, callbacks)
        useCloseConfirmation.getState().setPending(null)
      },
    })
    return
  }

  if (podItem.contentType === 'agent') {
    const podTerminalId = (podItem.config as { podTerminalId: string }).podTerminalId
    const isRunning = runningTerminals.some((t) => t.podTerminalId === podTerminalId)
    if (isRunning) {
      useCloseConfirmation.getState().setPending({
        label: podItem.label ?? 'Agent',
        onConfirm: () => {
          deleteItemWithCleanup(podItem, callbacks)
          useCloseConfirmation.getState().setPending(null)
        },
      })
      return
    }
  }
  deleteItemWithCleanup(podItem, callbacks)
}

/**
 * Focus a pod item — for terminals and agents, selects the running PTY instance.
 * No-op for non-terminal content types.
 */
export function focusItem(podItem: PodItem, runningTerminals: RunningTerminal[]): void {
  if (podItem.contentType === 'terminal' || podItem.contentType === 'agent') {
    const podTerminalId = (podItem.config as { podTerminalId: string }).podTerminalId
    const running = runningTerminals.find((t) => t.podTerminalId === podTerminalId)
    if (running) {
      const ui = useUIStore.getState()
      if (ui.selectedId !== running.ptyInstanceId) {
        ui.setSelected(running.ptyInstanceId)
      }
    }
  }
}
