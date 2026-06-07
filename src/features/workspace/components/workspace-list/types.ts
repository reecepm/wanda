import type { UnresolvedCounts } from '@/features/notifications'
import type { AgentStatus } from '../../utils/status-colors'

export type PodRuntimeKind = 'shell' | 'docker'

export type { AgentStatus } from '../../utils/status-colors'

export interface AgentSummary {
  id: string
  name: string
  agentType: 'claude' | 'codex' | 'opencode'
  status: AgentStatus
  /** Terminal id for joining to unresolved attention notifications. */
  podTerminalId?: string
  /** Derived from unresolved notifications (see use-attention-queue) or error status. */
  needsAttention?: boolean
  /** Human-readable summary of the first outstanding attention request, if any. */
  attentionReason?: string
}

/** One chat-session entry shown inside an expanded pod, alongside `AgentSummary`. */
export interface ChatSessionSummary {
  /** The `agent-session` pod-item id — the thing the sidebar click focuses. */
  id: string
  /** Shared session id (stable across pod-item re-attach). */
  sessionId: string
  /** Pod-item label, falling back to the session's persisted title. */
  name: string
  providerId: string
  /** Runtime state projected from `agent.session.listPersisted`. */
  state: 'idle' | 'running' | 'error' | 'closed' | 'starting' | 'ready' | 'cold'
  /** True when the session is currently resident in the in-memory registry. */
  resident: boolean
  /** Last event timestamp (ms epoch) for ordering + freshness hints. */
  lastEventAt: number | null
  /** True when an unanswered permission / error needs the user's attention. */
  needsAttention?: boolean
  attentionReason?: string
}

export interface PodSummary {
  id: string
  name: string
  status: 'stopped' | 'running' | 'failed' | 'starting' | 'stopping'
  runtimeKind: PodRuntimeKind
  /** Renderer-side optimistic row while pod creation/setup is still running. */
  isPending?: boolean
  progressLabel?: string
  /** Local PTY pod: no target, no environment, no docker runtime. Local pods
   * are pre-started at app bootstrap and hide the status dot unless failed. */
  isLocal?: boolean
  workspaceId: string
  agents?: AgentSummary[]
  chatSessions?: ChatSessionSummary[]
  hasWorktree?: boolean
  /** Paired server id the pod lives on. `null` = the local embedded server. */
  serverId?: string | null
}

export interface Workspace {
  id: string
  name: string
  pods: PodSummary[]
  /** Paired server id the workspace lives on. `null` = the local embedded server. */
  serverId?: string | null
  /** Display label for the remote server (hostname / user-chosen). Unset for local. */
  serverLabel?: string | null
  /** Cached avatar URL derived from the workspace's git remote — null when unknown. */
  iconUrl?: string | null
}

export interface WorkspaceListProps {
  workspaces: Workspace[]
  selectedPodId?: string
  selectedWorkspaceViewId?: string
  expandedWorkspaces: Set<string>
  onToggleWorkspace: (workspaceId: string) => void
  notificationCounts?: UnresolvedCounts | null
  onSelectPod: (podId: string) => void
  onCreateWorkspace: () => void
  onCreatePod: (workspaceId: string) => void
  onOpenProjectView?: (workspaceId: string) => void
  onWorkspaceSettings?: (workspaceId: string) => void
  onWorkspaceRename?: (workspaceId: string, name: string) => void
  onWorkspaceDelete?: (workspaceId: string) => void
  onReorderWorkspaces?: (workspaceIds: string[]) => void
  onReorderPods?: (workspaceId: string, podIds: string[]) => void
  onPodStart?: (podId: string) => void
  onPodStop?: (podId: string) => void
  onPodRestart?: (podId: string) => void
  onPodRename?: (podId: string, name: string) => void
  onPodDuplicate?: (podId: string) => void
  onPodDelete?: (podId: string) => void
  onPodOpenInEditor?: (podId: string, editorId: string) => void
  onPodMoveToWorkspace?: (podId: string, workspaceId: string) => void
  onPodSaveAsTemplate?: (podId: string) => void
  onPodBranchOff?: (podId: string) => void
  onPodSettings?: (podId: string) => void
  editors?: { id: string; name: string }[]
  selectedAgentId?: string
  onSelectAgent?: (podId: string, agentId: string) => void
  /** Pod-item id of the currently-focused chat session, if any. */
  selectedChatSessionItemId?: string
  onSelectChatSession?: (podId: string, sessionItemId: string) => void
}

/** Pod context-menu callbacks, threaded down to each pod row. */
export interface PodMenuCallbacks {
  onPodStart?: (podId: string) => void
  onPodStop?: (podId: string) => void
  onPodRestart?: (podId: string) => void
  onPodDuplicate?: (podId: string) => void
  onPodDelete?: (podId: string) => void
  onPodOpenInEditor?: (podId: string, editorId: string) => void
  onPodMoveToWorkspace?: (podId: string, workspaceId: string) => void
  onPodSaveAsTemplate?: (podId: string) => void
  onPodBranchOff?: (podId: string) => void
  onPodSettings?: (podId: string) => void
  editors?: { id: string; name: string }[]
  workspaces?: { id: string; name: string }[]
}
