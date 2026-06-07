import { createContext } from 'react'
import type { UnresolvedCounts } from '@/features/notifications'
import type { PodMenuCallbacks } from './types'

// Threaded-through values shared by every workspace/pod/agent row. Lifting
// them into context keeps the row components from re-passing the same
// notification counts, pod-menu callbacks, and agent/chat-session selection
// state down through each nesting level.

export interface WorkspaceListContextValue {
  notificationCounts?: UnresolvedCounts | null
  podMenuCallbacks: PodMenuCallbacks
  selectedAgentId?: string
  onSelectAgent?: (podId: string, agentId: string) => void
  selectedChatSessionItemId?: string
  onSelectChatSession?: (podId: string, sessionItemId: string) => void
}

export const WorkspaceListContext = createContext<WorkspaceListContextValue | null>(null)
