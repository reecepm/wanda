import { os as orpc } from '@orpc/server'
import type { AgentRuntime, ProviderRegistry } from '@wanda/agent-runtime'
import { type EffectBuilder, makeEffectORPC } from 'effect-orpc'
import type { AgentAttachmentService } from '../domains/agent-attachment'
import type { ShellExecFn } from '../domains/git/controller'
import type { PermissionPolicyStore } from '../domains/permission-policy'
import type {
  AgentConfigController,
  AgentController,
  AgentStatusService,
  AppManagedRuntime,
  Broadcaster,
  CommandParserService,
  DockerService,
  FileService,
  GitController,
  NotificationController,
  OnboardingController,
  PlanController,
  PodController,
  PodCrudController,
  PodItemController,
  ReviewController,
  RuntimeRegistryService,
  SecretsService,
  SettingsController,
  TaskStoreService,
  TaskViewController,
  ViewController,
  WorkenvController,
  WorkenvEvents,
  WorkenvExec,
  WorkenvExecShape,
  WorkenvReconciler,
  WorkenvTemplates,
  WorkspaceController,
  WorkspaceSettingsController,
  WorkspaceViewController,
} from '../services'
import type { GitStatusBroadcaster } from '../services/git-status-broadcaster'
import type { GitWatcher } from '../services/git-watcher'
import type { TargetManager } from '../targets/target-manager'
import { agentRoutes } from './agent'
import { agentAttachmentRoutes } from './agent-attachment'
import { agentPermissionRoutes } from './agent-permissions'
import { agentProviderRoutes } from './agent-providers'
import { agentSessionRoutes } from './agent-session'
import { dockerRoutes } from './docker'
import { fileRoutes } from './file'
import { gitRoutes } from './git'
import { gitWorktreeRoutes } from './git/worktrees'
import { graphiteRoutes } from './graphite'
import { resolveShellExec as resolveShellExecHelper, selectDirectory as selectDirectoryHelper } from './helpers'
import { notificationRoutes } from './notification'
import { onboardingRoutes } from './onboarding'
import { planRoutes } from './plan'
import { podRoutes } from './pod'
import { podItemRoutes } from './pod/items'
import { reviewRoutes } from './review'
import { secretsRoutes } from './secrets'
import { settingsRoutes } from './settings'
import { agentConfigRoutes } from './settings/agent-configs'
import { taskViewRoutes } from './settings/task-views'
import { systemRoutes } from './system'
import { taskRoutes } from './tasks'
import { terminalRoutes } from './terminal'
import { viewRoutes } from './view'
import { workenvRoutes } from './workenv'
import { workspaceRoutes } from './workspace'
import { workspaceSettingsRoutes } from './workspace/settings'
import { templateRoutes } from './workspace/templates'
import { workspaceViewRoutes } from './workspace-view'

/** Shared mutable state for agent cache-replay (set by main.ts event listeners, read by router) */
export interface AgentStateCache {
  models: { id: string; displayName: string; isDefault?: boolean }[] | null
  authUrl: string | null
  ready: boolean
}

type AppServices =
  | AgentStatusService
  | AgentConfigController
  | Broadcaster
  | WorkspaceController
  | PodController
  | PodCrudController
  | SettingsController
  | AgentController
  | AgentRuntime
  | AgentAttachmentService
  | PermissionPolicyStore
  | ProviderRegistry
  | TaskStoreService
  | ViewController
  | WorkspaceViewController
  | PodItemController
  | ReviewController
  | WorkspaceSettingsController
  | GitController
  | DockerService
  | FileService
  | NotificationController
  | OnboardingController
  | PlanController
  | TaskViewController
  | CommandParserService
  | SecretsService
  | WorkenvController
  | WorkenvEvents
  | WorkenvExec
  | WorkenvReconciler
  | WorkenvTemplates
  | RuntimeRegistryService

export interface AppRouterDeps {
  effectOs: EffectBuilder<any, any, any, any, any, any, AppServices, never>
  orpc: typeof orpc
  targetManager?: TargetManager
  eventBus?: { refresh: () => void }
  agentState?: AgentStateCache
  gitWatcher?: GitWatcher
  gitStatusBroadcaster?: GitStatusBroadcaster
  workenvExec?: WorkenvExecShape
  selectDirectory: () => Promise<string | null>
  resolveShellExec: (pod: { cwd: string }) => ShellExecFn | null
}

export interface AppRouterOpts {
  targetManager?: TargetManager
  eventBus?: { refresh: () => void }
  agentState?: AgentStateCache
  gitWatcher?: GitWatcher
  gitStatusBroadcaster?: GitStatusBroadcaster
  workenvExec?: WorkenvExecShape
}

export function createAppRouter(runtime: AppManagedRuntime, opts?: AppRouterOpts) {
  const effectOs = makeEffectORPC(runtime)
  const targetManager = opts?.targetManager
  const eventBus = opts?.eventBus
  const agentState = opts?.agentState
  const gitWatcher = opts?.gitWatcher
  const gitStatusBroadcaster = opts?.gitStatusBroadcaster
  const workenvExec = opts?.workenvExec

  const selectDirectory = selectDirectoryHelper
  const resolveShellExec = (pod: { cwd: string }) => resolveShellExecHelper(pod, targetManager)

  const deps: AppRouterDeps = {
    effectOs,
    orpc,
    targetManager,
    eventBus,
    agentState,
    gitWatcher,
    gitStatusBroadcaster,
    workenvExec,
    selectDirectory,
    resolveShellExec,
  }

  const wsRoutes = workspaceRoutes(deps)
  const { runArchiveScript, ...workspaceCrudRoutes } = wsRoutes

  const sysRoutes = systemRoutes(deps)
  const { stats: systemStats, ...appSystemRoutes } = sysRoutes

  return orpc.router({
    app: orpc.router({
      ...appSystemRoutes,
      ...gitWorktreeRoutes(deps),
      runArchiveScript,
    }),

    settings: orpc.router(settingsRoutes(deps)),
    agentConfig: orpc.router(agentConfigRoutes(deps)),
    workspace: orpc.router(workspaceCrudRoutes),
    pod: orpc.router(podRoutes(deps)),
    git: orpc.router(gitRoutes(deps)),
    graphite: orpc.router(graphiteRoutes(deps)),
    file: orpc.router(fileRoutes(deps)),
    podItem: orpc.router(podItemRoutes(deps)),
    view: orpc.router(viewRoutes(deps)),
    workspaceView: orpc.router(workspaceViewRoutes(deps)),
    template: orpc.router(templateRoutes(deps)),
    workspaceSettings: orpc.router(workspaceSettingsRoutes(deps)),
    docker: orpc.router(dockerRoutes(deps)),
    workenv: orpc.router(workenvRoutes(deps)),
    terminal: orpc.router(terminalRoutes(deps)),
    agent: orpc.router({
      // Legacy stub — kept for existing UI callers. To be removed once the
      // UI migrates to `agent.session.*` / `agent.providers.*`.
      ...agentRoutes(deps),
      session: orpc.router(agentSessionRoutes(deps)),
      providers: orpc.router(agentProviderRoutes(deps)),
      attachment: orpc.router(agentAttachmentRoutes(deps)),
      permissions: orpc.router(agentPermissionRoutes(deps)),
    }),
    tasks: orpc.router(taskRoutes(deps)),
    notification: orpc.router(notificationRoutes(deps)),
    onboarding: orpc.router(onboardingRoutes(deps)),
    plan: orpc.router(planRoutes(deps)),
    review: orpc.router(reviewRoutes(deps)),
    secrets: orpc.router(secretsRoutes(deps)),
    taskView: orpc.router(taskViewRoutes(deps)),
    system: orpc.router({ stats: systemStats }),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
