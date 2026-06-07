import { useQueryClient } from '@tanstack/react-query'
import { AGENT_TYPES } from '@/features/pod/utils/agent-utils'
import { generateUniquePodName } from '@/features/pod/utils/pod-names'
import { invalidateTrayQuery, navigateMainWindow } from '@/shared/app-bridge'
import { orpcUtils } from '@/shared/orpc'
import type { AgentType } from '@/types/schema'

/** Invalidate caches in both the tray and the main window. */
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['pod'] })
  // Tell the main process to broadcast to all windows (including main window)
  invalidateTrayQuery('pod', 'addAgent')
  invalidateTrayQuery('pod', 'start')
  invalidateTrayQuery('podItem', 'list')
}

export function useTrayActions() {
  const queryClient = useQueryClient()

  async function createPodWithAgent(opts: { workspaceId: string; prompt: string; agentType: AgentType }) {
    const workspaces = await orpcUtils.workspace.list.call({})
    const workspace = workspaces.find((w) => w.id === opts.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const existingPods = await orpcUtils.pod.list.call({ workspaceId: opts.workspaceId })
    const name = generateUniquePodName(existingPods.map((p) => p.name))

    const pod = await orpcUtils.pod.create.call({
      workspaceId: opts.workspaceId,
      name,
      cwd: workspace.cwd,
    })

    const agentLabel = AGENT_TYPES.find((a) => a.id === opts.agentType)?.label ?? opts.agentType
    const agent = await orpcUtils.pod.addAgent.call({
      podId: pod.id,
      name: `${agentLabel} Agent`,
      agentType: opts.agentType,
    })

    // Set prompt as args BEFORE pod.start() reads terminal rows from DB
    if (opts.prompt.trim()) {
      await orpcUtils.pod.updateTerminal.call({ id: agent.podTerminalId, args: [opts.prompt] })
    }

    await orpcUtils.pod.start.call({ id: pod.id })

    // Clear prompt arg so it doesn't replay on restart
    if (opts.prompt.trim()) {
      await orpcUtils.pod.updateTerminal.call({ id: agent.podTerminalId, args: [] })
    }

    invalidateAll(queryClient)
    navigateMainWindow(`/pods/${pod.id}`, { focusPodId: pod.id, focusAgentId: agent.id })
    return pod
  }

  async function spawnAgentForPod(opts: { podId: string; prompt: string; agentType: AgentType }) {
    const pod = await orpcUtils.pod.getById.call({ id: opts.podId })
    if (!pod) throw new Error('Pod not found')

    if (pod.status !== 'running') {
      await orpcUtils.pod.start.call({ id: opts.podId })
    }

    const agentLabel = AGENT_TYPES.find((a) => a.id === opts.agentType)?.label ?? opts.agentType
    const agent = await orpcUtils.pod.addAgent.call({
      podId: opts.podId,
      name: `${agentLabel} Agent`,
      agentType: opts.agentType,
    })

    if (opts.prompt.trim()) {
      await orpcUtils.pod.updateTerminal.call({ id: agent.podTerminalId, args: [opts.prompt] })
    }

    await orpcUtils.pod.startTerminal.call({ podTerminalId: agent.podTerminalId })

    if (opts.prompt.trim()) {
      await orpcUtils.pod.updateTerminal.call({ id: agent.podTerminalId, args: [] })
    }

    invalidateAll(queryClient)
    navigateMainWindow(`/pods/${opts.podId}`, { focusPodId: opts.podId, focusAgentId: agent.id })
  }

  return { createPodWithAgent, spawnAgentForPod, navigateMainWindow }
}
