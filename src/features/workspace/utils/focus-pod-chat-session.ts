import { panToCanvasNode, useViewStore } from '@/features/view'

/**
 * Focus an `agent-session` pod item within the view store. Mirrors
 * `focusPodAgent` — callers are expected to have navigated to the pod
 * already; this just switches the active pane + pans the canvas.
 *
 * The pod item id is resolved against the view store's known entities; if
 * the pod hasn't mounted yet we subscribe once and retry when it appears.
 */
export function focusPodChatSession(podId: string, podItemId: string): void {
  const apply = (): boolean => {
    const viewStore = useViewStore.getState()
    const podState = viewStore.entities[podId]
    if (!podState) return false
    const podItem = podState.podItems.find((pi) => pi.id === podItemId)
    if (!podItem) return false
    useViewStore.setState({ activeEntityId: podId })
    viewStore.focusPane(podItem.id)
    requestAnimationFrame(() => panToCanvasNode(podItem.id))
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
