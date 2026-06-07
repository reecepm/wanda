// -----------------------------------------------------------------------------
// @wanda/agent-protocol — cross-boundary types + Zod schemas for the agent
// subsystem.
//
// Isomorphic, zero Electron / DOM deps. The runtime, providers, renderer,
// and tests all import from here. Every public schema has a paired inferred
// type (`*Schema` + `z.infer<typeof *Schema>`); call sites should prefer the
// type and only reach for the schema at validation boundaries.
// -----------------------------------------------------------------------------

export type { AgentCapabilities, AgentMode, ModeColorTier, ModelOption, ReasoningEffort } from './capabilities.ts'
// capabilities
export {
  AgentCapabilitiesSchema,
  AgentModeSchema,
  ModeColorTierSchema,
  ModelOptionSchema,
  ReasoningEffortSchema,
} from './capabilities.ts'
export type { AttachmentRef, ImageRef, PromptBlock, ResourceLink } from './content.ts'
// content
export {
  AttachmentRefSchema,
  ImageRefSchema,
  MediaTypeSchema,
  PromptBlockSchema,
  ResourceLinkSchema,
  Sha256Schema,
} from './content.ts'
export type {
  AgentEvent,
  AgentEventEnvelope,
  AgentEventKind,
  ProviderExt,
} from './event.ts'
// event
export {
  AGENT_EVENT_KINDS,
  AgentEventEnvelopeSchema,
  AgentEventSchema,
  ErrorEventSchema,
  ModeChangedSchema,
  ModelChangedSchema,
  PermissionRequestedSchema,
  PermissionResolvedSchema,
  PlanUpdatedSchema,
  ProviderExtSchema,
  QuestionRequestedSchema,
  QuestionResolvedSchema,
  ReasoningCompletedSchema,
  ReasoningDeltaSchema,
  ReasoningEffortChangedSchema,
  SessionClosedSchema,
  SessionStartedSchema,
  safeParseAgentEvent,
  TextCompletedSchema,
  TextDeltaSchema,
  ToolCompletedSchema,
  ToolStartedSchema,
  ToolUpdatedSchema,
  TurnCancelledSchema,
  TurnCompletedSchema,
  TurnStartedSchema,
} from './event.ts'
export type {
  AttachmentId,
  MessageId,
  ModeId,
  ModelId,
  PlanItemId,
  ProviderId,
  QuestionId,
  RequestId,
  SessionId,
  ToolCallId,
  TurnId,
} from './ids.ts'
// ids
export {
  AttachmentIdSchema,
  MessageIdSchema,
  ModeIdSchema,
  ModelIdSchema,
  newAttachmentId,
  newMessageId,
  newPlanItemId,
  newQuestionId,
  newRequestId,
  newSessionId,
  newToolCallId,
  newTurnId,
  PlanItemIdSchema,
  ProviderIdSchema,
  QuestionIdSchema,
  RequestIdSchema,
  SessionIdSchema,
  ToolCallIdSchema,
  TurnIdSchema,
} from './ids.ts'
export type {
  Decision,
  PermissionAction,
  PermissionPolicyRow,
  PermissionRequest,
  PermissionScope,
  QuestionAnswer,
  QuestionOption,
} from './permission.ts'
// permission
export {
  DecisionSchema,
  PermissionActionSchema,
  PermissionPolicyRowSchema,
  PermissionRequestSchema,
  PermissionScopeSchema,
  QuestionAnswerSchema,
  QuestionOptionSchema,
} from './permission.ts'
export type { PlanItem, PlanItemStatus } from './plan.ts'
// plan
export { PlanItemSchema, PlanItemStatusSchema } from './plan.ts'
// rpc-io
export * from './rpc-io.ts'
export type { FileLocation, ToolCallDetail } from './tool-detail.ts'
// tool-detail
export {
  DiffDetailSchema,
  FetchDetailSchema,
  FileLocationSchema,
  OtherDetailSchema,
  ReadDetailSchema,
  SearchDetailSchema,
  ShellDetailSchema,
  TerminalDetailSchema,
  ThinkDetailSchema,
  ToolCallDetailSchema,
} from './tool-detail.ts'
export type { ToolKind } from './tool-kind.ts'
// tool-kind
export { TOOL_KINDS, ToolKindSchema } from './tool-kind.ts'
export type {
  DataPart,
  Part,
  PermissionPart,
  PlanPart,
  QuestionPart,
  ReasoningPart,
  StopReason,
  TextPart,
  ToolPart,
  UIMessage,
} from './ui-message.ts'
// ui-message
export { PartSchema, StopReasonSchema, UIMessageSchema } from './ui-message.ts'

// versions
export {
  CURRENT_EVENT_SCHEMA_VERSION,
  isSupportedSchemaVersion,
  MIN_READ_SCHEMA_VERSION,
} from './versions.ts'

// --- Wire constant (re-export with a friendly name) ---------------------------

/** WS channel carrying `AgentEventEnvelope` payloads. */
export const AGENT_SESSION_EVENT_CHANNEL = 'event:agentSession:event' as const
