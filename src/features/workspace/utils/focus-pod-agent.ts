import type { QueryClient } from '@tanstack/react-query'
import { panToCanvasNode, useViewStore } from '@/features/view'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import type { AgentItemConfig } from '@/types/schema'

export type AgentMatcher = { by: 'agentId'; agentId: string } | { by: 'terminalId'; podTerminalId: string }

/**
 * Apply view-store focus to a specific agent within a pod.
 *
 * Callers are expected to have already navigated to `/pods/$podId` and set
 * the active pod id in the UI store. This function only handles the
 * view-store-level focus: which pane is active, a canvas pan to the node,
 * and selecting the PTY instance so keystrokes route correctly.
 *
 * Matcher can be by `podAgentId` (used from the sidebar, which knows agents
 * by their DB id) or by `podTerminalId` (used from notifications, which join
 * to agents via their terminal id).
 *
 * If the view store hasn't loaded the pod's entities yet — common when
 * focus comes from a notification click before the pod has been mounted —
 * subscribes once and retries when the pod state appears.
 */
export function focusPodAgent(queryClient: QueryClient, podId: string, matcher: AgentMatcher) {
  const apply = () => {
    const viewStore = useViewStore.getState()
    const podState = viewStore.entities[podId]
    if (!podState) return false

    const podItem = podState.podItems.find((pi) => {
      if (pi.contentType !== 'agent') return false
      const cfg = pi.config as AgentItemConfig
      return matcher.by === 'agentId' ? cfg.podAgentId === matcher.agentId : cfg.podTerminalId === matcher.podTerminalId
    })
    if (!podItem) return false

    // Switch view store to this pod so focusPane targets the right pod
    useViewStore.setState({ activeEntityId: podId })
    viewStore.focusPane(podItem.id)

    // Pan canvas to the node if canvas view is active (deferred so React
    // Flow has processed the current nodes after any pod/view switch)
    requestAnimationFrame(() => panToCanvasNode(podItem.id))

    // Try to focus the PTY instance from cached running terminals
    const runningTerminals = queryClient.getQueryData<{ podTerminalId: string; ptyInstanceId: string }[]>(
      orpcUtils.pod.runningTerminals.queryKey({ input: { id: podId } }),
    )
    if (runningTerminals) {
      const podTerminalId = (podItem.config as AgentItemConfig).podTerminalId
      const running = runningTerminals.find((t) => t.podTerminalId === podTerminalId)
      if (running) {
        useUIStore.getState().setSelected(running.ptyInstanceId)
      }
    }
    return true
  }

  if (!apply()) {
    const unsub = useViewStore.subscribe((state) => {
      if (state.entities[podId]) {
        unsub()
        apply()
      }
    })
  }
}
