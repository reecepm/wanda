// -----------------------------------------------------------------------------
// Typed event channel contract.
//
// Single source of truth for every `broadcast(channel, ...args)` /
// WebSocket envelope that the server pushes to clients. Both the emitter
// side (electron shell's `broadcast()`) and the consumer side
// (`window.wanda.onXxx(cb)`) must agree on the argument tuple per channel.
// -----------------------------------------------------------------------------

import type { PlanStatus } from './domain-types'
import type { GitStatusEvent } from './git-status'
import type { WorkenvBootstrapStatus, WorkenvEventType, WorkenvState } from './workenv'

// --- Per-channel argument tuples ------------------------------------------

export interface AppEvents {
  // ---- Terminal hot path --------------------------------------------------
  'terminal:data': [streamId: string, data: string]
  'terminal:exit': [streamId: string, code: number]
  'terminal:zoom': [direction: 'in' | 'out' | 'reset']
  'terminal:urlDetected': [streamId: string, url: string, podId: string | null]

  // ---- Pod lifecycle ------------------------------------------------------
  'pod:status': [podId: string, status: 'stopped' | 'starting' | 'running' | 'stopping' | 'failed']
  'pod:recovered': [summary: { recovered: number; failed: number; wasDirty: boolean }]

  // ---- Agent --------------------------------------------------------------
  'agent:message': [sessionId: string, msg: AgentMessage]
  'agent:permission-request': [req: AgentPermissionRequest]
  'agent:permission-resolved': []
  'agent:auth-required': [authUrl: string]
  'agent:models-loaded': [models: AgentModel[]]
  'agent:ready': []
  'agent:status': [terminalId: string, status: AgentStatusPayload]

  // ---- Notifications / cache invalidation --------------------------------
  'notifications:changed': []
  'orpc:invalidate': [namespace: string, method: string]

  // ---- Git status (unified broadcaster) ----------------------------------
  'git:status': [event: GitStatusEvent]

  // ---- Shell bridges (window-targeted) -----------------------------------
  'shortcut:forward': [binding: string, shift: boolean, alt: boolean]
  'app:navigate': [route: string, opts?: { focusPodId?: string; focusAgentId?: string }]
  'file:changed': [watchId: string, mtimeMs: number]

  // ---- Workenv ------------------------------------------------------------
  // Observational only — `workenvs` SQLite rows are authoritative. Missed
  // events are recoverable by re-reading state.
  'workenv.created': [id: string]
  'workenv.updated': [id: string]
  'workenv.destroyed': [id: string]
  'workenv.state.changed': [id: string, from: WorkenvState, to: WorkenvState]
  'workenv.bootstrap.progress': [id: string, stepIndex: number, stepName: string, status: WorkenvBootstrapStatus]
  'workenv.prebuild.progress': [
    templateId: string,
    hash: string,
    stepIndex: number,
    stepName: string,
    status: WorkenvBootstrapStatus,
  ]
  'workenv.prebuild.log': [templateId: string, hash: string, chunk: string]
  'workenv.health': [id: string, ok: boolean]
  /** Cache-invalidation marker: a new row landed in workenv_events. */
  'workenv.event.added': [id: string, type: WorkenvEventType]
  'workenv.ports.changed': [id: string]

  // ---- Plans --------------------------------------------------------------
  // Observational events; the `plans` table is authoritative. Renderers and
  // subscribed agents react by re-fetching.
  'plan.created': [planId: string, workspaceId: string]
  'plan.updated': [planId: string, version: number]
  'plan.status.changed': [planId: string, status: PlanStatus]
  'plan.deleted': [planId: string]
  'plan.comment.added': [planId: string, commentId: string]
  'plan.comment.updated': [planId: string, commentId: string]
  'plan.comment.removed': [planId: string, commentId: string]
}

// --- Payload shapes (co-located so one file owns the wire) ----------------

export interface AgentMessage {
  readonly method: string
  readonly params: Record<string, unknown>
}

export interface AgentPermissionRequest {
  readonly requestId: number
  readonly type: 'commandExecution' | 'fileChange'
  readonly command?: string
  readonly cwd?: string
  readonly reason?: string
  readonly grantRoot?: string
}

export interface AgentModel {
  readonly id: string
  readonly displayName: string
  readonly isDefault?: boolean
}

export interface AgentStatusPayload {
  readonly status: string
  readonly agentType: string
  readonly sessionId?: string
  readonly errorDetail?: string
  /** PTY exit code, only set once the agent terminal has exited. */
  readonly exitCode?: number
  /** Tail of the agent terminal's output captured at exit (ANSI-stripped). */
  readonly exitOutput?: string
}

export type NotificationType =
  | 'agent:permission-request'
  | 'workflow:input-required'
  | 'terminal:exit'
  | 'workflow:run-failed'
  | 'workflow:run-completed'

export type NotificationPriority = 'blocking' | 'urgent' | 'info'

export interface NotificationEmitInput {
  type: NotificationType
  priority: NotificationPriority
  podId?: string | null
  podTerminalId?: string | null
  workspaceId?: string | null
  title: string
  body?: string | null
  payload?: Record<string, unknown> | null
}

// --- Helpers --------------------------------------------------------------

/** Union of all known channel names. Useful for discrimination. */
export type AppEventChannel = keyof AppEvents

/** Tuple of arguments for a specific channel. */
export type AppEventArgs<K extends AppEventChannel> = AppEvents[K]

/** Listener signature for a specific channel. */
export type AppEventListener<K extends AppEventChannel> = (...args: AppEventArgs<K>) => void

/** Envelope used on the WebSocket transport — matches WsGateway.broadcast. */
export interface AppEventEnvelope<K extends AppEventChannel = AppEventChannel> {
  readonly v: 1
  readonly channel: K
  readonly args: AppEventArgs<K>
}
