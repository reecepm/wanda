// This file re-exports from domains/ and infrastructure for backward
// compatibility. New code should import from domains/, infra/, or services/ directly.

export { AppLayer, type AppManagedRuntime, AppRuntime } from '../domains'

// --- Domain re-exports ---
export { AgentController, configureAgentRuntime } from '../domains/agent'
export { GitController } from '../domains/git'
export { NotificationController } from '../domains/notification'
export { OnboardingController } from '../domains/onboarding'
export type { PermissionPolicyInsert, PermissionPolicyRow } from '../domains/permission-policy'
export { PermissionPolicyStore } from '../domains/permission-policy'
export { PlanController } from '../domains/plan'
export {
  getPodRuntime,
  PodContainerController,
  PodController,
  PodCrudController,
  PodItemController,
  PodLifecycleController,
} from '../domains/pod'
export { ReviewController } from '../domains/review'
export type { ProviderSecretStatus } from '../domains/secrets'
export { SecretsService } from '../domains/secrets'
export { AgentConfigController, SettingsController, TaskViewController } from '../domains/settings'
export { TaskStoreService } from '../domains/tasks'
export { ViewController } from '../domains/view'
export type { WorkenvExecShape } from '../domains/workenv'
export {
  BootstrapRunner,
  WorkenvController,
  WorkenvEvents,
  WorkenvExec,
  WorkenvHealth,
  WorkenvReconciler,
  WorkenvTemplates,
} from '../domains/workenv'
export { WorkspaceController, WorkspaceSettingsController } from '../domains/workspace'
export { WorkspaceViewController } from '../domains/workspace-view'
export { Broadcaster, configureBroadcaster } from '../infra/broadcaster'
export { CommandParserService } from '../infra/command-parser'
export { configureDatabase, DatabaseService } from '../infra/database'
export { GcService } from '../infra/gc'
export type { AgentStatus, AgentStatusEntry, AgentStatusEvent } from '../packages/agent-hooks'
// --- Infrastructure services ---
export { AgentStatusService } from '../packages/agent-hooks'
export { DockerService } from './docker.service'
export { AppError, ConflictError, InternalError, NotFoundError, ValidationError } from './errors'
export type { FileChangeCallback } from './file.service'
export { FileAccessError, FileService, resolveSafe } from './file.service'
export type { BroadcastGitStatusFn } from './git-status-broadcaster'
export { GitStatusBroadcaster } from './git-status-broadcaster'
export { PtyService } from './pty.service'
export { RuntimeRegistryService } from './runtime-registry.service'
