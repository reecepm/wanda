// -----------------------------------------------------------------------------
// Map runtime tagged errors → oRPC `ORPCError` codes.
//
// The runtime layer uses `Data.TaggedError`; the router converts them to
// protocol-level codes for the client. Client code discriminates on
// `err.code`.
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/server'

export type AgentErrorCode =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_CLOSED'
  | 'AGENT_BUSY'
  | 'TURN_ACTIVE'
  | 'TURN_MISMATCH'
  | 'INVALID_MODE'
  | 'INVALID_MODEL'
  | 'PROMPT_EMPTY'
  | 'ATTACHMENT_NOT_FOUND'
  | 'PERMISSION_NOT_FOUND'
  | 'PERMISSION_ALREADY_RESOLVED'
  | 'QUESTION_NOT_FOUND'
  | 'QUESTION_ALREADY_RESOLVED'
  | 'INVALID_ANSWER'
  | 'PROVIDER_NOT_FOUND'
  | 'PROVIDER_UNAVAILABLE'
  | 'CAPABILITY_HANDSHAKE_FAILED'
  | 'WORKSPACE_NOT_FOUND'
  | 'CWD_INVALID'
  | 'INTERNAL_SERVER_ERROR'

export function agentError(
  code: AgentErrorCode,
  message: string,
  cause?: unknown,
): ORPCError<AgentErrorCode, undefined> {
  return new ORPCError(code, { message, cause })
}

/** Map any runtime tagged error to an `ORPCError`. Accepts `unknown` so
 * callers can use it directly with `Effect.mapError` without narrowing. */
export function fromRuntimeError(raw: unknown): ORPCError<AgentErrorCode, undefined> {
  if (!raw || typeof raw !== 'object' || !('_tag' in raw)) {
    // Non-tagged error: surface it server-side before we collapse to the
    // generic "Internal Server Error" that the client sees. Without this
    // log, a thrown defect or raw Error from deep inside the runtime
    // disappears into the void.
    // eslint-disable-next-line no-console
    console.error('[agent-session.errors] untagged error bubbled to router:', raw)
    const message = raw instanceof Error ? raw.message : 'unknown error'
    return agentError('INTERNAL_SERVER_ERROR', message, raw)
  }
  const err = raw as Record<string, unknown> & { _tag: string }
  switch (err._tag) {
    case 'SessionNotFound':
      return agentError('SESSION_NOT_FOUND', `Session ${stringify(err.sessionId)} not found`)
    case 'SessionClosed':
      return agentError('SESSION_CLOSED', `Session ${stringify(err.sessionId)} is closed`)
    case 'AgentBusy': {
      const reason = typeof err.reason === 'string' ? `: ${err.reason}` : ''
      return agentError('AGENT_BUSY', `Session ${stringify(err.sessionId)} already running a turn${reason}`)
    }
    case 'TurnActive':
      return agentError('TURN_ACTIVE', `A turn is in progress; finish or cancel first`)
    case 'TurnMismatch':
      return agentError('TURN_MISMATCH', `Turn id does not match current or recent turn`)
    case 'InvalidMode':
      return agentError('INVALID_MODE', `Mode ${stringify(err.modeId)} not advertised by agent`)
    case 'InvalidModel':
      return agentError('INVALID_MODEL', `Model ${stringify(err.modelId)} not advertised by agent`)
    case 'PromptEmpty':
      return agentError('PROMPT_EMPTY', 'Prompt must contain at least one block')
    case 'AttachmentNotFound':
      return agentError('ATTACHMENT_NOT_FOUND', `Attachment ${stringify(err.attachmentId)} not found`)
    case 'PermissionNotFound':
      return agentError('PERMISSION_NOT_FOUND', `Permission request ${stringify(err.requestId)} not found`)
    case 'PermissionAlreadyResolved':
      return agentError('PERMISSION_ALREADY_RESOLVED', `Permission ${stringify(err.requestId)} already resolved`)
    case 'QuestionNotFound':
      return agentError('QUESTION_NOT_FOUND', `Question ${stringify(err.questionId)} not found`)
    case 'QuestionAlreadyResolved':
      return agentError('QUESTION_ALREADY_RESOLVED', `Question ${stringify(err.questionId)} already resolved`)
    case 'InvalidAnswer':
      return agentError('INVALID_ANSWER', 'Answer does not match question option set')
    case 'ProviderNotFound':
      return agentError('PROVIDER_NOT_FOUND', `Provider ${stringify(err.providerId)} not registered`)
    case 'ProviderUnavailable':
      return agentError(
        'PROVIDER_UNAVAILABLE',
        `Provider ${stringify(err.providerId)} is unavailable: ${stringify(err.reason)}`,
      )
    case 'CapabilityHandshakeFailed':
      return agentError('CAPABILITY_HANDSHAKE_FAILED', `Provider failed initialize: ${stringify(err.reason)}`)
    case 'WorkspaceNotFound':
      return agentError('WORKSPACE_NOT_FOUND', `Workspace ${stringify(err.workspaceId)} not found`)
    case 'CwdInvalid':
      return agentError('CWD_INVALID', 'cwd is not an existing directory')
    case 'RuntimeInternal': {
      const msg = typeof err.message === 'string' ? err.message : 'unknown error'
      // Log with the cause so server operators see the actual failure
      // (e.g. provider spawn threw, scope close failed). The client only
      // receives the generic INTERNAL_SERVER_ERROR shape.
      // eslint-disable-next-line no-console
      console.error('[agent-session.errors] RuntimeInternal:', msg, err.cause ?? '')
      return agentError('INTERNAL_SERVER_ERROR', msg, err.cause)
    }
    case 'AgentProviderError': {
      const phase = typeof err.phase === 'string' ? err.phase : 'unknown'
      const msg = typeof err.message === 'string' ? err.message : 'provider error'
      // `prompt` phase is emitted as a runtime event; the router never sees
      // it here, but handle it defensively.
      if (phase === 'detect' || phase === 'spawn' || phase === 'resume') {
        // eslint-disable-next-line no-console
        console.error(`[agent-session.errors] AgentProviderError (${phase}):`, msg, err.cause ?? '')
        return agentError('PROVIDER_UNAVAILABLE', `Provider ${phase}: ${msg}`)
      }
      if (phase === 'setMode' || phase === 'setModel') {
        return agentError('INVALID_MODE', msg)
      }
      // eslint-disable-next-line no-console
      console.error(`[agent-session.errors] AgentProviderError (${phase}) reached router:`, msg, err.cause ?? '')
      return agentError('INTERNAL_SERVER_ERROR', msg)
    }
    default:
      // eslint-disable-next-line no-console
      console.error('[agent-session.errors] unhandled runtime error tag:', err._tag, err)
      return agentError('INTERNAL_SERVER_ERROR', `unhandled runtime error: ${err._tag}`)
  }
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
