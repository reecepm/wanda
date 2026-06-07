// -----------------------------------------------------------------------------
// Electron-side composition for `@wanda/agent-runtime`.
//
// The runtime package is isomorphic; it's the job of this domain adapter to
// build `AgentRuntime` + `ProviderRegistry` services with real
// `EventLog` / `SubscriptionManager` / provider instances supplied by the
// server runtime. Matches the `configureBroadcaster` / `configureDatabase`
// pattern used elsewhere in `electron/infra/`.
// -----------------------------------------------------------------------------

export {
  AgentProviderRegistryLive,
  AgentRuntimeLive,
  configureAgentRuntimeDeps,
} from './runtime-adapter'
