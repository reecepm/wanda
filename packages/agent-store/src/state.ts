// -----------------------------------------------------------------------------
// ChatState shape.
//
// Durable store (this file) holds everything except per-token streaming text.
// Streaming lives in `streaming-atom.ts` — the reducer commits on
// `*.completed` and that's when durable text appears in `state.messages`.
// -----------------------------------------------------------------------------

import type {
  AgentCapabilities,
  AgentEvent,
  AgentMode,
  Decision,
  MessageId,
  ModeId,
  ModelId,
  ModelOption,
  PlanItem,
  ProviderId,
  QuestionAnswer,
  QuestionId,
  ReasoningEffort,
  RequestId,
  SessionId,
  StopReason,
  UIMessage,
} from '@wanda/agent-protocol'

export type SessionPhase = 'cold' | 'info' | 'subscribed' | 'backfill' | 'live' | 'full-resync' | 'error'

export interface SessionSlice {
  readonly sessionId: SessionId
  readonly providerId: ProviderId | null
  readonly capabilities: AgentCapabilities | null
  readonly modes: ReadonlyArray<AgentMode>
  readonly modelOptions: ReadonlyArray<ModelOption>
  readonly currentModeId: ModeId | null
  readonly modelId: ModelId | null
  readonly reasoningEffort: ReasoningEffort | null
  readonly status: 'starting' | 'ready' | 'running' | 'closed'
  readonly closedReason: string | null
  readonly isWaitingOnUser: boolean
  readonly activeTurnId: string | null
  /**
   * Current turn's assistant message. Non-message-carrying events (tool, plan,
   * permission, question) append parts here. Reset on turn start/end. Null
   * outside a turn.
   */
  readonly activeAssistantMessageId: MessageId | null
}

export interface Usage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
  readonly costMicros?: number
}

export interface TurnSlice {
  readonly turnId: string
  readonly status: 'running' | 'completed' | 'cancelled' | 'error'
  readonly stopReason?: StopReason
  readonly startedAt: number
  readonly completedAt?: number
  readonly usage?: Usage
}

export interface PendingPermission {
  readonly requestId: RequestId
  readonly request: Extract<AgentEvent, { kind: 'permission.requested' }>
  readonly arrivedAt: number
  readonly timeoutAt: number | null
  readonly resolution?: Decision
}

export interface PendingQuestion {
  readonly questionId: QuestionId
  readonly request: Extract<AgentEvent, { kind: 'question.requested' }>
  readonly arrivedAt: number
  readonly answer?: QuestionAnswer
}

export interface ChatState {
  readonly phase: SessionPhase
  /** Per-session applied cursor (04 §3). Envelopes with seq ≤ this are dedup'd. */
  readonly appliedSeq: number
  readonly epoch: number
  readonly session: SessionSlice

  /** Arrival order. Streaming text lives in `streaming-atom`, not here. */
  readonly messages: ReadonlyArray<UIMessage>
  /** messageId → index into messages, for O(1) upsert. */
  readonly messageIndex: ReadonlyMap<MessageId, number>
  /**
   * Local-only user echo shown immediately after submit. Cleared once the
   * runtime's persisted `text.completed(role: 'user')` lands or the prompt
   * call fails.
   */
  readonly optimisticUserMessage: UIMessage | null
  readonly optimisticUserTurnId: string | null

  readonly turns: Readonly<Record<string, TurnSlice>>

  readonly plan: ReadonlyArray<PlanItem> | null
  readonly hasActivePlan: boolean

  readonly pendingPermissions: ReadonlyArray<PendingPermission>
  readonly pendingQuestions: ReadonlyArray<PendingQuestion>

  readonly lastError: { code?: string; message: string; recoverable: boolean } | null

  /** True once `replayPageByResource(direction: 'backward')` returns empty. */
  readonly atHead: boolean
  /** Oldest `seq` currently in-memory; used as the upper bound for backfill. */
  readonly oldestSeq: number | null
}

export function initialChatState(sessionId: SessionId): ChatState {
  return {
    phase: 'cold',
    appliedSeq: 0,
    epoch: 0,
    session: {
      sessionId,
      providerId: null,
      capabilities: null,
      modes: [],
      modelOptions: [],
      currentModeId: null,
      modelId: null,
      reasoningEffort: null,
      status: 'starting',
      closedReason: null,
      isWaitingOnUser: false,
      activeTurnId: null,
      activeAssistantMessageId: null,
    },
    messages: [],
    messageIndex: new Map(),
    optimisticUserMessage: null,
    optimisticUserTurnId: null,
    turns: {},
    plan: null,
    hasActivePlan: false,
    pendingPermissions: [],
    pendingQuestions: [],
    lastError: null,
    atHead: false,
    oldestSeq: null,
  }
}

/** Exported for internal modules (reducer, store); also safe to export to consumers. */
export type ModeIdOrNull = ModeId | null
export type ModelIdOrNull = ModelId | null
export type ReasoningEffortOrNull = ReasoningEffort | null
