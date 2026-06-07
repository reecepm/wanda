// -----------------------------------------------------------------------------
// Shared contracts barrel.
//
// Single import surface for anything that crosses the client/server
// boundary. Both the Electron shell and the standalone web client should
// only touch `electron/...` via this module.
// -----------------------------------------------------------------------------

export * from './agent-capabilities'
export * from './agent-commands'
export * from './agent-config'
export * from './agent-events'
export type {
  BootstrapRequest,
  BootstrapResult,
  PairedClientInfo,
  PairedSessionSummary,
  SessionRole,
  WsTokenResult,
} from './auth'
export type { ServerCapabilities, ServerFeatures, SshDescriptor } from './capabilities'
export type * from './domain-types'
export type {
  AgentMessage,
  AgentModel,
  AgentPermissionRequest,
  AgentStatusPayload,
  AppEventArgs,
  AppEventChannel,
  AppEventEnvelope,
  AppEventListener,
  AppEvents,
  NotificationEmitInput,
  NotificationPriority,
  NotificationType,
} from './events'
export type {
  ChecksStatus,
  GitStatus,
  GitStatusEvent,
  GitStatusLocal,
  GitStatusPR,
  GitStatusRemote,
  PRMergeable,
  PRState,
} from './git-status'
export type { AppClient, AppRouter } from './router'
export {
  type WorkenvBase,
  type WorkenvBootstrapStatus,
  type WorkenvBootstrapStep,
  type WorkenvCapability,
  type WorkenvConfig,
  type WorkenvEnvValue,
  type WorkenvEventType,
  type WorkenvHealthcheck,
  type WorkenvLayer,
  type WorkenvLayerKind,
  type WorkenvLayerShellStep,
  type WorkenvMount,
  type WorkenvPort,
  type WorkenvResolvedPort,
  type WorkenvResources,
  type WorkenvRuntime,
  type WorkenvState,
  workenvBootstrapStatusSchema,
  workenvBootstrapStepSchema,
  workenvCapabilitySchema,
  workenvConfigSchema,
  workenvEnvValueSchema,
  workenvEventTypeSchema,
  workenvHealthcheckSchema,
  workenvLayerSchema,
  workenvLayerShellStepSchema,
  workenvMountSchema,
  workenvPortSchema,
  workenvResolvedPortSchema,
  workenvResourcesSchema,
  workenvRuntimeSchema,
  workenvStateSchema,
} from './workenv'
export {
  type OrbstackRuntimeState,
  orbstackRuntimeStateSchema,
  type WorkenvRuntimeState,
  workenvRuntimeStateSchema,
} from './workenv-runtime-state'
