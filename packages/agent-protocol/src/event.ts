// -----------------------------------------------------------------------------
// Canonical AgentEvent discriminated union + persisted envelope.
//
// Every event that hits `@wanda/event-log` and every event the WS gateway
// broadcasts on `event:agentSession:event` is one of these variants. The
// `provider` sidecar is unstructured by design: providers stash
// implementation-private data there (e.g. Claude's `signature`,
// `resultBlocks` for stateless resume). Generic consumers ignore it.
// See 00-index R9.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { AgentCapabilitiesSchema, AgentModeSchema, ModelOptionSchema, ReasoningEffortSchema } from './capabilities.ts'
import { AttachmentRefSchema, ImageRefSchema } from './content.ts'
import {
  MessageIdSchema,
  ModeIdSchema,
  ModelIdSchema,
  ProviderIdSchema,
  QuestionIdSchema,
  RequestIdSchema,
  SessionIdSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from './ids.ts'
import { DecisionSchema, PermissionRequestSchema, QuestionAnswerSchema, QuestionOptionSchema } from './permission.ts'
import { PlanItemSchema } from './plan.ts'
import { FileLocationSchema, ToolCallDetailSchema } from './tool-detail.ts'
import { ToolKindSchema } from './tool-kind.ts'
import { CURRENT_EVENT_SCHEMA_VERSION } from './versions.ts'

// --- Sidecar (R9) -------------------------------------------------------------

/** Provider-private extension bag. Unstable; generic consumers ignore. */
export const ProviderExtSchema = z.record(z.string(), z.unknown())
export type ProviderExt = z.infer<typeof ProviderExtSchema>

/** Either a plain attachment or an image (with optional w/h). Used on text.completed. */
export const AttachmentOrImageRefSchema = z.discriminatedUnion('kind', [AttachmentRefSchema, ImageRefSchema])

// --- Shared sub-shapes --------------------------------------------------------

const SessionHeader = z.object({
  sessionId: SessionIdSchema,
  provider: ProviderExtSchema.optional(),
})
const TurnHeader = SessionHeader.extend({ turnId: TurnIdSchema })

const ToolStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled'])
const StopReasonEventSchema = z.enum(['end_turn', 'max_tokens', 'tool_use', 'cancelled', 'error', 'other'])

const UsageSchema = z.object({
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  cacheReadTokens: z.number().int().min(0).optional(),
  cacheWriteTokens: z.number().int().min(0).optional(),
  reasoningTokens: z.number().int().min(0).optional(),
  /** Provider-reported cost in USD micros (1/1_000_000). */
  costMicros: z.number().int().min(0).optional(),
})

// --- Event variants -----------------------------------------------------------

export const SessionStartedSchema = SessionHeader.extend({
  kind: z.literal('session.started'),
  providerId: ProviderIdSchema,
  capabilities: AgentCapabilitiesSchema,
  modes: z.array(AgentModeSchema),
  currentModeId: ModeIdSchema.optional(),
  modelId: ModelIdSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  modelOptions: z.array(ModelOptionSchema).default([]),
  persistenceHandle: z.unknown().optional(),
})

export const SessionClosedSchema = SessionHeader.extend({
  kind: z.literal('session.closed'),
  reason: z.enum(['user', 'error', 'idle_evicted', 'provider_exited', 'server_shutdown']),
  message: z.string().max(4096).optional(),
})

export const TurnStartedSchema = TurnHeader.extend({
  kind: z.literal('turn.started'),
})

export const TurnCompletedSchema = TurnHeader.extend({
  kind: z.literal('turn.completed'),
  stopReason: StopReasonEventSchema,
  usage: UsageSchema.optional(),
})

export const TurnCancelledSchema = TurnHeader.extend({
  kind: z.literal('turn.cancelled'),
  /** Whether the agent acknowledged the cancel vs was killed. */
  acknowledged: z.boolean().default(false),
})

export const TextDeltaSchema = TurnHeader.extend({
  kind: z.literal('text.delta'),
  messageId: MessageIdSchema,
  /** Appended text, not the full message to date. */
  text: z.string(),
  /** Monotonic per-message ordinal; renderer uses to detect drops. */
  index: z.number().int().min(0),
})

export const TextCompletedSchema = TurnHeader.extend({
  kind: z.literal('text.completed'),
  messageId: MessageIdSchema,
  /** Full concatenated text. Renderer commits this to the durable store. */
  text: z.string(),
  /**
   * Role of the speaker for this text. Optional for back-compat with older
   * providers that only emit assistant-side `text.completed`; absent ⇒
   * `'assistant'`. User-role events are emitted by the runtime from the
   * prompt's content blocks.
   */
  role: z.enum(['user', 'assistant']).optional(),
  /**
   * Attachments accompanying the text (for now: user-role only). See
   * specs/ui-centric-agents/04-event-log-integration.md §5.5.
   */
  attachments: z.array(AttachmentOrImageRefSchema).optional(),
})

export const ReasoningDeltaSchema = TurnHeader.extend({
  kind: z.literal('reasoning.delta'),
  messageId: MessageIdSchema,
  text: z.string(),
  index: z.number().int().min(0),
})

export const ReasoningCompletedSchema = TurnHeader.extend({
  kind: z.literal('reasoning.completed'),
  messageId: MessageIdSchema,
  text: z.string(),
})

export const ToolStartedSchema = TurnHeader.extend({
  kind: z.literal('tool.started'),
  toolCallId: ToolCallIdSchema,
  toolKind: ToolKindSchema,
  title: z.string().max(512).optional(),
  detail: ToolCallDetailSchema.optional(),
  locations: z.array(FileLocationSchema).optional(),
})

export const ToolUpdatedSchema = TurnHeader.extend({
  kind: z.literal('tool.updated'),
  toolCallId: ToolCallIdSchema,
  /** Lattice enforced in runtime: failed > cancelled > completed > in_progress > pending. */
  status: ToolStatusSchema,
  detail: ToolCallDetailSchema.optional(),
  progress: z
    .object({
      stdoutChunk: z.string().optional(),
      stderrChunk: z.string().optional(),
      percent: z.number().min(0).max(100).optional(),
    })
    .optional(),
})

export const ToolCompletedSchema = TurnHeader.extend({
  kind: z.literal('tool.completed'),
  toolCallId: ToolCallIdSchema,
  status: z.enum(['completed', 'failed', 'cancelled']),
  result: z
    .object({
      summary: z.string().max(16_384).optional(),
      attachmentId: z.string().min(1).optional(),
      data: z.unknown().optional(),
      error: z.string().max(16_384).optional(),
    })
    .optional(),
})

export const PlanUpdatedSchema = TurnHeader.extend({
  kind: z.literal('plan.updated'),
  plan: z.array(PlanItemSchema),
})

export const PermissionRequestedSchema = TurnHeader.extend({
  kind: z.literal('permission.requested'),
  requestId: RequestIdSchema,
  request: PermissionRequestSchema,
  /** Absolute deadline (ms epoch); null = no auto-timeout. */
  timeoutAt: z.number().int().min(0).nullable().optional(),
})

export const PermissionResolvedSchema = TurnHeader.extend({
  kind: z.literal('permission.resolved'),
  requestId: RequestIdSchema,
  decision: DecisionSchema,
  fromPolicyRowId: z.string().optional(),
})

export const QuestionRequestedSchema = TurnHeader.extend({
  kind: z.literal('question.requested'),
  questionId: QuestionIdSchema,
  question: z.string().min(1).max(4096),
  options: z.array(QuestionOptionSchema).optional(),
  allowFreeform: z.boolean().default(false),
})

export const QuestionResolvedSchema = TurnHeader.extend({
  kind: z.literal('question.resolved'),
  questionId: QuestionIdSchema,
  answer: QuestionAnswerSchema,
})

export const ModeChangedSchema = SessionHeader.extend({
  kind: z.literal('mode.changed'),
  modeId: ModeIdSchema,
})

export const ModelChangedSchema = SessionHeader.extend({
  kind: z.literal('model.changed'),
  modelId: ModelIdSchema,
})

export const ReasoningEffortChangedSchema = SessionHeader.extend({
  kind: z.literal('reasoning.effort.changed'),
  reasoningEffort: ReasoningEffortSchema,
})

export const ErrorEventSchema = SessionHeader.extend({
  kind: z.literal('error'),
  turnId: TurnIdSchema.optional(),
  message: z.string().min(1).max(16_384),
  recoverable: z.boolean(),
  /** Machine-readable code: e.g. `AGENT_BUSY`, `AUTH_REQUIRED`. */
  code: z.string().max(128).optional(),
  stderrTail: z.string().max(16_384).optional(),
})

// --- Union --------------------------------------------------------------------

export const AgentEventSchema = z.discriminatedUnion('kind', [
  SessionStartedSchema,
  SessionClosedSchema,
  TurnStartedSchema,
  TurnCompletedSchema,
  TurnCancelledSchema,
  TextDeltaSchema,
  TextCompletedSchema,
  ReasoningDeltaSchema,
  ReasoningCompletedSchema,
  ToolStartedSchema,
  ToolUpdatedSchema,
  ToolCompletedSchema,
  PlanUpdatedSchema,
  PermissionRequestedSchema,
  PermissionResolvedSchema,
  QuestionRequestedSchema,
  QuestionResolvedSchema,
  ModeChangedSchema,
  ModelChangedSchema,
  ReasoningEffortChangedSchema,
  ErrorEventSchema,
])
export type AgentEvent = z.infer<typeof AgentEventSchema>

export const AGENT_EVENT_KINDS = [
  'session.started',
  'session.closed',
  'turn.started',
  'turn.completed',
  'turn.cancelled',
  'text.delta',
  'text.completed',
  'reasoning.delta',
  'reasoning.completed',
  'tool.started',
  'tool.updated',
  'tool.completed',
  'plan.updated',
  'permission.requested',
  'permission.resolved',
  'question.requested',
  'question.resolved',
  'mode.changed',
  'model.changed',
  'reasoning.effort.changed',
  'error',
] as const
export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number]

// --- Envelope (payload form on the wire + in event-log) -----------------------

export const AgentEventEnvelopeSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_EVENT_SCHEMA_VERSION),
  event: AgentEventSchema,
})
export type AgentEventEnvelope = z.infer<typeof AgentEventEnvelopeSchema>

// --- Helpers ------------------------------------------------------------------

/** Never throws; returns null on parse failure. Suitable for replay paths. */
export function safeParseAgentEvent(value: unknown): AgentEvent | null {
  const result = AgentEventSchema.safeParse(value)
  return result.success ? result.data : null
}
