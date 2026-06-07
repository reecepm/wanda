// -----------------------------------------------------------------------------
// Renderer entry for the UI-centric agents subsystem.
//
// Re-exports the transport factory + mountable container. Workspace-level
// integration (view kinds, sidebar entries, route wiring) is T11 proper
// and consumes these exports.
// -----------------------------------------------------------------------------

export { AgentSessionContainer } from './AgentSessionContainer'
export { createAgentSessionTransport } from './transport'
