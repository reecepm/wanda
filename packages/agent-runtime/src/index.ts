// -----------------------------------------------------------------------------
// @wanda/agent-runtime — per-session lifecycle, provider orchestration,
// event fanout.
//
// This barrel exports the skeleton only. The concrete `AgentRuntime`
// implementation (registry, turn-runner, event fanout) lands in follow-up
// tickets; consumers write against the types / state machine / mock-provider
// surface exposed here.
// -----------------------------------------------------------------------------

// Errors
export * from './errors.ts'
export type { EventFanout, EventFanoutDeps } from './event-fanout.ts'
export { makeEventFanout } from './event-fanout.ts'
export type { ActiveTurn, ManagedSession } from './managed-session.ts'
// Managed session (exposed for advanced tests + future direct handle access)
export { makeManagedSession, touch } from './managed-session.ts'
export type { MockScript, MockStep } from './mock-provider.ts'
// Mock provider (tests + Storybook)
export { mockProvider } from './mock-provider.ts'
export type {
  PendingPermissionRow,
  PendingPermissionsStore,
  PendingPermissionsStoreInsert,
} from './pending-permissions-store.ts'
// Pending permissions store (durable mirror of outstanding permission prompts
// so a server restart can drain them without leaving the UI hanging).
export { makeInMemoryPendingPermissionsStore } from './pending-permissions-store.ts'
export type {
  PermissionPolicyContext,
  PermissionPolicySaveInput,
  PermissionPolicyStore,
} from './permission-policy-store.ts'
export { makeProviderRegistry, ProviderRegistry, ProviderRegistryLive } from './provider-registry.ts'
export type {
  AgentRuntimeDeps,
  PersistedSessionSummary,
  SessionDetail,
  SessionSummary,
} from './runtime.ts'
// Services
export { AgentRuntime, makeAgentRuntime } from './runtime.ts'
export { makeSessionRegistry, SessionRegistry, SessionRegistryLive } from './session-registry.ts'
export type {
  PersistedSessionSnapshot,
  SessionStore,
  SessionStoreInsert,
  TitleSource,
} from './session-store.ts'
// Session store (persistence hook used by the electron app to rehydrate
// across restarts; tests pass an in-memory impl).
export { makeInMemorySessionStore } from './session-store.ts'
export type { SessionState, SessionStateTag, StateTransition } from './state-machine.ts'
// State machine
export {
  canTransition,
  isTerminal,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
} from './state-machine.ts'
// Types
export type {
  AgentProvider,
  AgentSession,
  AgentSessionHandle,
  DetectResult,
  PersistenceHandle,
  ProviderEmit,
  ProviderEnv,
  ProviderManifest,
  SpawnContext,
  TurnContext,
} from './types.ts'
