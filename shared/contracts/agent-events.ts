// -----------------------------------------------------------------------------
// Cross-boundary re-exports for AgentEvent + envelope + WS channel.
//
// Renderer and Electron code both import from here so we keep one trusted
// path to the schemas. The schemas themselves live in `@wanda/agent-protocol`.
// -----------------------------------------------------------------------------

export type {
  AgentEvent,
  AgentEventEnvelope,
  AgentEventKind,
  ProviderExt,
} from '@wanda/agent-protocol'
export {
  AGENT_EVENT_KINDS,
  AGENT_SESSION_EVENT_CHANNEL,
  AgentEventEnvelopeSchema,
  AgentEventSchema,
  safeParseAgentEvent,
} from '@wanda/agent-protocol'
