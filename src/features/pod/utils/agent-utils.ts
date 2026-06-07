import { type PodItem, useViewStore } from '@/features/view'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import type { AgentItemConfig, AgentType } from '@/types/schema'

export const AGENT_TYPES = [
  { id: 'claude' as const, label: 'Claude' },
  { id: 'codex' as const, label: 'Codex' },
  { id: 'opencode' as const, label: 'OpenCode' },
] satisfies { id: AgentType; label: string }[]

/**
 * Create a new agent, optionally start it, fetch updated pod items,
 * and return the new PodItem (or null if not found).
 *
 * When the agent is started (isRunning), this also pre-sets the UI store's
 * `selectedId` to the new PTY instance id so the xterm auto-focuses as soon
 * as it mounts. See the note in `createTerminal` for the full reasoning.
 */
export async function createAgentItem(
  podId: string,
  agentType: AgentType,
  opts?: { isRunning?: boolean },
): Promise<PodItem | null> {
  // For paired remote pods `podId` is `remote:<regId>:<uuid>`. Resolve
  // the correct RPC client (local vs. paired) from the namespaced id,
  // then unwrap it before sending it to the server.
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const agent = await client.pod.addAgent({
    podId: realPodId,
    name: `${AGENT_TYPES.find((a) => a.id === agentType)?.label ?? agentType} Agent`,
    agentType,
  })
  let ptyInstanceId: string | null = null
  if (opts?.isRunning) {
    const started = await client.pod.startTerminal({ podTerminalId: agent.podTerminalId })
    ptyInstanceId = started?.ptyInstanceId ?? null
  }
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find(
    (pi) => pi.contentType === 'agent' && (pi.config as AgentItemConfig).podAgentId === agent.id,
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
