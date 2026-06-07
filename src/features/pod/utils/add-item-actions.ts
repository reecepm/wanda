import { useMemo } from 'react'
import { toast } from 'sonner'
import { attachAgentSessionItem, createAgentSessionItem } from '@/features/pod/utils/agent-session-utils'
import { AGENT_TYPES, createAgentItem } from '@/features/pod/utils/agent-utils'
import { createBrowserItem } from '@/features/pod/utils/browser-utils'
import { createCommandItem } from '@/features/pod/utils/command-utils'
import { createMarkdownItem } from '@/features/pod/utils/markdown-utils'
import { createTerminal } from '@/features/pod/utils/terminal-utils'
import type { PodItem } from '@/features/view/store/view-store'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'
import type { AgentType } from '@/types/schema'

export { AGENT_TYPES }

export interface AddItemActions {
  addTerminal: () => Promise<void>
  addBrowser: () => Promise<void>
  addAgent: (agentType: AgentType) => Promise<void>
  addAgentSession: (providerId: string) => Promise<void>
  attachAgentSession: (sessionId: string, label?: string) => Promise<void>
  addCommand: (podCommandId: string) => Promise<void>
  addMarkdown: () => Promise<void>
  newCommand: () => void
  commandsNotInView: { id: string; name: string }[]
}

export interface UseAddItemActionsArgs {
  podId: string
  isRunning: boolean
  terminalCount: number
  commandConfigs: { id: string; name: string }[]
  /** Set of podCommandIds already visible — used to filter the command submenu. */
  commandIdsInView: Set<string>
  /** How to place a newly created item into the view. */
  placeItem: (item: PodItem) => void
  /** Called after any item is created (query invalidation). */
  onItemsChanged: () => void
  /** Open the "New Command" dialog. */
  onNewCommand?: () => void
}

export interface BuildAddItemActionsArgs extends UseAddItemActionsArgs {
  commandsNotInView: { id: string; name: string }[]
}

export function buildAddItemActions({
  podId,
  isRunning,
  terminalCount,
  commandConfigs: _commandConfigs,
  commandIdsInView: _commandIdsInView,
  commandsNotInView,
  placeItem,
  onItemsChanged,
  onNewCommand,
}: BuildAddItemActionsArgs): AddItemActions {
  return {
    commandsNotInView,
    addTerminal: async () => {
      const item = await createTerminal(podId, { isRunning, count: terminalCount })
      if (item) placeItem(item)
      onItemsChanged()
    },
    addBrowser: async () => {
      const item = await createBrowserItem(podId)
      if (item) placeItem(item)
      onItemsChanged()
    },
    addMarkdown: async () => {
      const { relPath } = await orpcForPod(podId).file.pickMarkdownFile({ podId: unwrapPodId(podId) })
      if (!relPath) return
      const item = await createMarkdownItem(podId, relPath)
      if (item) placeItem(item)
      onItemsChanged()
    },
    addAgent: async (agentType: AgentType) => {
      try {
        const item = await createAgentItem(podId, agentType, { isRunning })
        if (item) placeItem(item)
        onItemsChanged()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`Failed to start ${agentType}`, { description: message })
      }
    },
    addAgentSession: async (providerId: string) => {
      try {
        const item = await createAgentSessionItem(podId, { providerId, updateStore: false })
        if (item) placeItem(item)
        onItemsChanged()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error('Failed to start agent session', { description: message })
      }
    },
    attachAgentSession: async (sessionId: string, label?: string) => {
      try {
        const item = await attachAgentSessionItem(podId, sessionId, { label })
        if (item) placeItem(item)
        onItemsChanged()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error('Failed to resume agent session', { description: message })
      }
    },
    addCommand: async (podCommandId: string) => {
      const item = await createCommandItem(podId, podCommandId)
      if (item) placeItem(item)
      onItemsChanged()
    },
    newCommand: () => onNewCommand?.(),
  }
}

export function useAddItemActions({
  podId,
  isRunning,
  terminalCount,
  commandConfigs,
  commandIdsInView,
  placeItem,
  onItemsChanged,
  onNewCommand,
}: UseAddItemActionsArgs): AddItemActions {
  const commandsNotInView = useMemo(
    () => commandConfigs.filter((cmd) => !commandIdsInView.has(cmd.id)),
    [commandConfigs, commandIdsInView],
  )

  return useMemo<AddItemActions>(
    () =>
      buildAddItemActions({
        podId,
        isRunning,
        terminalCount,
        commandConfigs,
        commandIdsInView,
        commandsNotInView,
        placeItem,
        onItemsChanged,
        onNewCommand,
      }),
    [
      podId,
      isRunning,
      terminalCount,
      commandConfigs,
      commandIdsInView,
      commandsNotInView,
      placeItem,
      onItemsChanged,
      onNewCommand,
    ],
  )
}
