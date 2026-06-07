// -----------------------------------------------------------------------------
// Tagged error types for the runtime boundary.
//
// Every public `AgentRuntime` method's error channel is a union of these.
// The router (03-orpc-router) wraps them via a tag → ORPC code map (09 §16.1).
// -----------------------------------------------------------------------------

import type { ModeId, ModelId, ProviderId, QuestionId, RequestId, SessionId, TurnId } from '@wanda/agent-protocol'
import { Data } from 'effect'

export class SessionNotFound extends Data.TaggedError('SessionNotFound')<{
  readonly sessionId: SessionId
}> {}

export class SessionClosed extends Data.TaggedError('SessionClosed')<{
  readonly sessionId: SessionId
}> {}

export class AgentBusy extends Data.TaggedError('AgentBusy')<{
  readonly sessionId: SessionId
  readonly reason?: string
}> {}

export class TurnActive extends Data.TaggedError('TurnActive')<{
  readonly sessionId: SessionId
  readonly currentTurnId: TurnId
}> {}

export class TurnMismatch extends Data.TaggedError('TurnMismatch')<{
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly currentTurnId?: TurnId
}> {}

export class InvalidMode extends Data.TaggedError('InvalidMode')<{
  readonly sessionId: SessionId
  readonly modeId: ModeId
}> {}

export class InvalidModel extends Data.TaggedError('InvalidModel')<{
  readonly sessionId: SessionId
  readonly modelId: ModelId
}> {}

export class PromptEmpty extends Data.TaggedError('PromptEmpty')<{
  readonly sessionId: SessionId
}> {}

export class AttachmentNotFound extends Data.TaggedError('AttachmentNotFound')<{
  readonly attachmentId: string
}> {}

export class PermissionNotFound extends Data.TaggedError('PermissionNotFound')<{
  readonly requestId: RequestId
}> {}

export class PermissionAlreadyResolved extends Data.TaggedError('PermissionAlreadyResolved')<{
  readonly requestId: RequestId
}> {}

export class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{
  readonly questionId: QuestionId
}> {}

export class QuestionAlreadyResolved extends Data.TaggedError('QuestionAlreadyResolved')<{
  readonly questionId: QuestionId
}> {}

export class InvalidAnswer extends Data.TaggedError('InvalidAnswer')<{
  readonly questionId: QuestionId
}> {}

export class ProviderNotFound extends Data.TaggedError('ProviderNotFound')<{
  readonly providerId: ProviderId
}> {}

export class ProviderUnavailable extends Data.TaggedError('ProviderUnavailable')<{
  readonly providerId: ProviderId
  readonly reason: string
}> {}

export class CapabilityHandshakeFailed extends Data.TaggedError('CapabilityHandshakeFailed')<{
  readonly providerId: ProviderId
  readonly reason: string
}> {}

export class WorkspaceNotFound extends Data.TaggedError('WorkspaceNotFound')<{
  readonly workspaceId: string
}> {}

export class CwdInvalid extends Data.TaggedError('CwdInvalid')<{ readonly cwd: string }> {}

export class RuntimeInternal extends Data.TaggedError('RuntimeInternal')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/** Umbrella for provider-side errors surfaced out of spawn/prompt. */
export class AgentProviderError extends Data.TaggedError('AgentProviderError')<{
  readonly providerId: ProviderId
  readonly phase: 'detect' | 'spawn' | 'resume' | 'prompt' | 'setMode' | 'setModel' | 'shutdown'
  readonly message: string
  readonly cause?: unknown
  readonly recoverable: boolean
}> {}

export class ProviderResumeUnsupported extends Data.TaggedError('ProviderResumeUnsupported')<{
  readonly providerId: ProviderId
}> {}
