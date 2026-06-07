import { type PodItem, useViewStore } from '@/features/view/store/view-store'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'

export function agentSessionLabel(providerId?: string): string {
  switch (providerId) {
    case 'codex':
      return 'Codex'
    case 'mock':
      return 'Mock Agent'
    default:
      return 'Agent'
  }
}

export function createOptimisticAgentSessionItem(
  podId: string,
  opts?: { providerId?: string; label?: string },
): PodItem {
  const providerId = opts?.providerId ?? 'mock'
  return {
    id: `optimistic-agent-session-${crypto.randomUUID()}`,
    podId: unwrapPodId(podId),
    contentType: 'agent-session',
    label: opts?.label ?? agentSessionLabel(providerId),
    labelSource: 'default',
    config: {
      providerId,
      pending: true,
    },
    sortOrder: Date.now(),
  }
}

export function addOptimisticAgentSessionItem(item: PodItem): void {
  const store = useViewStore.getState()
  const entityId = store.activeEntityId
  const state = entityId ? store.entities[entityId] : undefined
  if (!state || state.podItems.some((pi) => pi.id === item.id)) return
  store.updatePodItems([...state.podItems, item])
}

/**
 * Create a UI-centric agent session + a pod item that renders it. The server
 * creates the session first (via `@wanda/agent-runtime`) and then persists a
 * pod item with `contentType: 'agent-session'`.
 */
export async function createAgentSessionItem(
  podId: string,
  opts?: { providerId?: string; label?: string; updateStore?: boolean },
): Promise<PodItem | null> {
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const result = await client.pod.addAgentSession({
    podId: realPodId,
    providerId: opts?.providerId ?? 'mock',
    label: opts?.label ?? agentSessionLabel(opts?.providerId ?? 'mock'),
  })
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find((pi) => pi.id === result.itemId)
  if (newPodItem) {
    if (opts?.updateStore !== false) useViewStore.getState().updatePodItems(updatedItems)
    return newPodItem
  }
  return null
}

/**
 * Attach a previously-created agent session to a pod as a new item. Useful
 * for resuming archived / recent sessions — the server keeps the session row
 * pod-agnostic, so attaching doesn't reassign ownership, it just adds a view.
 */
export async function attachAgentSessionItem(
  podId: string,
  sessionId: string,
  opts?: { label?: string },
): Promise<PodItem | null> {
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const result = await client.pod.attachAgentSession({
    podId: realPodId,
    sessionId,
    label: opts?.label ?? 'Agent',
  })
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find((pi) => pi.id === result.itemId)
  if (newPodItem) {
    useViewStore.getState().updatePodItems(updatedItems)
    return newPodItem
  }
  return null
}
