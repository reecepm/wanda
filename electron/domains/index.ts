import { Layer, Logger, ManagedRuntime } from 'effect'
import { BroadcasterLive } from '../infra/broadcaster'
import { CommandParserServiceLive } from '../infra/command-parser'
import { DatabaseServiceLive } from '../infra/database'
import { GcServiceLive } from '../infra/gc'
// --- Infrastructure service layers ---
import { AgentStatusServiceLive } from '../packages/agent-hooks'
import { DockerServiceLive } from '../services/docker.service'
import { FileServiceLive } from '../services/file.service'
import { PtyServiceLive } from '../services/pty.service'
import { makeRuntimeRegistryFromEnv } from '../services/runtime-registry.service'
// --- Domain controller layers ---
import { AgentControllerLive } from './agent'
import { AgentAttachmentServiceLive } from './agent-attachment'
import { AgentProviderRegistryLive, AgentRuntimeLive } from './agent-runtime'
import { GitControllerLive } from './git'
import { NotificationControllerLive } from './notification'
import { OnboardingControllerLive } from './onboarding'
import { PermissionPolicyStoreLive } from './permission-policy'
import { PlanControllerLive } from './plan'
import {
  PodContainerControllerLive,
  PodControllerLive,
  PodCrudControllerLive,
  PodItemControllerLive,
  PodLifecycleControllerLive,
} from './pod'
import { ReviewControllerLive } from './review'
import { SecretsServiceLive } from './secrets'
import { AgentConfigControllerLive, SettingsControllerLive, TaskViewControllerLive } from './settings'
import { TaskStoreServiceLive } from './tasks'
import { ViewControllerLive } from './view'
import {
  BootstrapRunnerLive,
  WorkenvControllerLive,
  WorkenvEventsLive,
  WorkenvExecLive,
  WorkenvHealthLive,
  WorkenvReconcilerLive,
  WorkenvTemplatesLive,
} from './workenv'
import { WorkspaceControllerLive, WorkspaceSettingsControllerLive } from './workspace'
import { WorkspaceViewControllerLive } from './workspace-view'

// --- Layer composition ---

const BaseLive = Layer.mergeAll(
  AgentStatusServiceLive,
  DatabaseServiceLive,
  PtyServiceLive,
  DockerServiceLive,
  FileServiceLive,
  BroadcasterLive,
  CommandParserServiceLive,
  AgentRuntimeLive,
  AgentProviderRegistryLive,
)

const CoreDomains = Layer.mergeAll(
  SettingsControllerLive,
  AgentConfigControllerLive,
  WorkspaceControllerLive,
  PodItemControllerLive,
  ViewControllerLive,
  WorkspaceSettingsControllerLive,
  GitControllerLive,
  NotificationControllerLive,
  TaskViewControllerLive,
  SecretsServiceLive,
  AgentAttachmentServiceLive,
  PermissionPolicyStoreLive,
  PlanControllerLive,
).pipe(Layer.provideMerge(BaseLive))

// TaskStoreService depends on SettingsController, so it slots in ABOVE
// CoreDomains rather than beside it.
const WithTasks = TaskStoreServiceLive.pipe(Layer.provideMerge(CoreDomains))

// Workenv stack — built BELOW PodController so the pod controller can pull
// WorkenvController to drive lifecycle (auto-start a stopped VM before
// exec'ing terminals). None of the workenv services import PodController,
// so this ordering is acyclic.
const WorkenvFoundation = Layer.mergeAll(WorkenvEventsLive, makeRuntimeRegistryFromEnv()).pipe(
  Layer.provideMerge(WithTasks),
)
const WorkenvFoundationWithExec = WorkenvExecLive.pipe(Layer.provideMerge(WorkenvFoundation))
const WithBootstrap = BootstrapRunnerLive.pipe(Layer.provideMerge(WorkenvFoundationWithExec))
const WithHealth = WorkenvHealthLive.pipe(Layer.provideMerge(WithBootstrap))
const WithTemplates = WorkenvTemplatesLive.pipe(Layer.provideMerge(WithHealth))
const WithWorkenv = WorkenvControllerLive.pipe(Layer.provideMerge(WithTemplates))
const WithReconciler = WorkenvReconcilerLive.pipe(Layer.provideMerge(WithWorkenv))

const WithPodSupport = Layer.mergeAll(
  PodCrudControllerLive,
  PodLifecycleControllerLive,
  PodContainerControllerLive,
).pipe(Layer.provideMerge(WithReconciler))

const WithOnboarding = OnboardingControllerLive.pipe(Layer.provideMerge(WithPodSupport))

const WithPod = Layer.mergeAll(PodControllerLive, GcServiceLive).pipe(
  Layer.provideMerge(WithOnboarding),
  Layer.provideMerge(AgentControllerLive),
)

const WithReview = ReviewControllerLive.pipe(Layer.provideMerge(WithPod))

export const AppLayer = WorkspaceViewControllerLive.pipe(Layer.provideMerge(WithReview), Layer.provide(Logger.pretty))

export const AppRuntime = ManagedRuntime.make(AppLayer)
export type AppManagedRuntime = typeof AppRuntime
