import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import { AgentStatusService } from '../../../packages/agent-hooks'
import { resolveWandaMcpEnabledForPod } from '../../../packages/agent-mcp'
import { log } from '../../../packages/logger'
import { PtyService } from '../../../services/pty.service'
import type { TargetManager } from '../../../targets/target-manager'
import { AgentConfigController } from '../../settings'
import { WorkenvController, WorkenvExec } from '../../workenv'
import {
  type CommandTagRow,
  clearPodContainerState,
  countPodsByStatus,
  getAgentById,
  getAllPods,
  getCommandById,
  getContainerLifecycleDefault,
  getPodById,
  getTerminalById,
  listAgentsByPod,
  listCommandsByPod,
  listPodsByWorkenv,
  listPodsByWorkspace,
  listPodsWithContainerId,
  listRunningPods,
  listTerminalsByPod,
  markPodStoppedAndClearContainer,
  type NotificationRow,
  type PodAgentRow,
  type PodCommandRow,
  type PodCommandUpdateInput,
  type PodCommandWithTags,
  type PodRow,
  type PodStatus,
  type PodTerminalRow,
  type PodTerminalUpdateInput,
  type PodUpdateInput,
  setPodGitContext,
  setPodWorkenv,
} from '../repository'
import type { AgentType, CommandArg, PodGitContext, PodRuntime } from '../types'
import { getPodRuntime, PodContainerController, resolveTargetForPod } from './container'
import { PodCrudController } from './crud'
import { PodItemController } from './items'
import { PodLifecycleController } from './lifecycle'
import { makePodRuntimeState } from './pod/state'
import { makePodTerminals } from './pod/terminals'

// Re-export helpers so existing imports from './pod' continue to work
export { getPodRuntime, isLocalPty, resolveTargetForPod } from './container'

export interface PodControllerShape {
  // Pod CRUD
  readonly listByWorkspace: (workspaceId: string) => Effect.Effect<PodRow[]>
  readonly listByWorkenv: (workenvId: string) => Effect.Effect<PodRow[]>
  readonly countByStatus: (status: PodStatus) => Effect.Effect<number>
  readonly getById: (id: string) => Effect.Effect<PodRow | undefined>
  readonly create: (input: {
    workspaceId: string
    name: string
    cwd: string
    shell?: string
    env?: Record<string, string>
    runtime?: PodRuntime
    sliceBranch?: string
    containerLifecycle?: 'inherit' | 'keep-running' | 'stop-on-exit'
    gitContext?: PodGitContext | null
    wandaMcpPolicy?: 'inherit' | 'include' | 'exclude' | null
  }) => Effect.Effect<PodRow>
  readonly update: (id: string, input: PodUpdateInput) => Effect.Effect<PodRow>
  readonly setWorkenv: (id: string, workenvId: string | null) => Effect.Effect<PodRow | undefined>
  readonly setGitContext: (id: string, gitContext: PodGitContext | null) => Effect.Effect<PodRow | undefined>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly duplicate: (id: string) => Effect.Effect<PodRow | null>

  // Terminal config CRUD
  readonly addTerminal: (input: {
    podId: string
    name: string
    command?: string
    args?: string[]
    env?: Record<string, string>
    restartPolicy?: 'never' | 'on-failure' | 'always'
  }) => Effect.Effect<PodTerminalRow>
  readonly updateTerminal: (id: string, input: PodTerminalUpdateInput) => Effect.Effect<PodTerminalRow>
  readonly removeTerminal: (id: string) => Effect.Effect<void>
  readonly listTerminals: (podId: string) => Effect.Effect<PodTerminalRow[]>

  /** Start a single terminal within an already-running pod */
  readonly startTerminal: (podTerminalId: string) => Effect.Effect<{ ptyInstanceId: string } | null>

  // Lifecycle
  readonly start: (id: string) => Effect.Effect<void, Error>
  readonly stop: (id: string) => Effect.Effect<void>
  readonly restart: (id: string) => Effect.Effect<void>
  /** Auto-start local PTY pods when viewed; no-op for Docker/environment pods */
  readonly ensureStarted: (id: string) => Effect.Effect<void, Error>
  /** Start every local-PTY pod in parallel. Used during app bootstrap so local pods
   * are warm before the user sees the UI. Returns counts for logging. */
  readonly ensureAllLocalStarted: () => Effect.Effect<{ started: number; skipped: number; failed: number }>
  readonly stopAllForWorkspace: (workspaceId: string) => Effect.Effect<void>
  readonly stopAll: () => Effect.Effect<number>
  readonly runningTerminals: (
    podId: string,
  ) => Effect.Effect<{ podTerminalId: string; ptyInstanceId: string; name: string }[]>

  // Agent config CRUD (delegates to PodCrudController)
  readonly addAgent: (input: { podId: string; name: string; agentType: AgentType }) => Effect.Effect<PodAgentRow>
  readonly removeAgent: (podAgentId: string) => Effect.Effect<void>
  readonly listAgents: (podId: string) => Effect.Effect<
    (PodAgentRow & {
      terminal: PodTerminalRow
      attentionRequests: NotificationRow[]
      needsAttention: boolean
    })[]
  >
  readonly runningAgents: (
    podId: string,
  ) => Effect.Effect<
    { podAgentId: string; podTerminalId: string; ptyInstanceId: string; name: string; agentType: string }[]
  >

  // Command config CRUD (delegates to PodCrudController)
  readonly addCommand: (input: {
    podId: string
    name: string
    command: string
    directory?: string
    directoryMode?: 'absolute' | 'relative'
    autoStart?: boolean
    args?: CommandArg[]
  }) => Effect.Effect<PodCommandRow>
  readonly updateCommand: (id: string, input: PodCommandUpdateInput) => Effect.Effect<PodCommandRow>
  readonly removeCommand: (id: string) => Effect.Effect<void>
  readonly listCommands: (podId: string) => Effect.Effect<PodCommandWithTags[]>
  readonly importCommands: (
    podId: string,
    commands: Array<{
      name: string
      command: string
      directory?: string
      directoryMode?: 'absolute' | 'relative'
      autoStart?: boolean
      args?: CommandArg[]
      tagNames?: string[]
    }>,
  ) => Effect.Effect<PodCommandRow[]>
  readonly startCommand: (podCommandId: string) => Effect.Effect<{ ptyInstanceId: string } | null>
  readonly stopCommand: (podCommandId: string) => Effect.Effect<void>
  readonly restartCommand: (podCommandId: string) => Effect.Effect<void>
  readonly runningCommands: (
    podId: string,
  ) => Effect.Effect<{ podCommandId: string; ptyInstanceId: string; name: string }[]>
  readonly addCommandToView: (podCommandId: string) => Effect.Effect<void>

  // Command tags (delegates to PodCrudController)
  readonly listTags: (podId: string) => Effect.Effect<CommandTagRow[]>
  readonly createTag: (podId: string, name: string) => Effect.Effect<CommandTagRow>
  readonly deleteTag: (id: string) => Effect.Effect<void>
  readonly tagCommand: (commandId: string, tagId: string) => Effect.Effect<void>
  readonly untagCommand: (commandId: string, tagId: string) => Effect.Effect<void>

  // Active view
  readonly setActiveView: (podId: string, viewId: string | null) => Effect.Effect<PodRow>
  readonly isWandaMcpEnabled: (podId: string) => Effect.Effect<boolean>

  // Port scanning & stream mapping
  readonly streamToPodId: (streamId: string) => string | undefined
  readonly streamToTerminalId: (streamId: string) => string | undefined
  readonly terminalToPodId: (terminalId: string) => string | undefined
  readonly isCommandStream: (streamId: string) => boolean

  // Recovery & shutdown
  readonly recoverContainers: () => Effect.Effect<{ recovered: number; failed: number }>
  readonly shutdown: () => Promise<void>

  // TargetManager injection
  readonly setTargetManager: (tm: TargetManager) => void

  // HTTP port injection (for agent status hooks)
  readonly setHttpPort: (port: number) => void
  /** Current HTTP port, or null if the server is not yet listening. */
  readonly getHttpPort: () => number | null

  // Hook token injection (authenticates the /agent-status webhook)
  readonly setHookToken: (token: string) => void
  /** Current hook token, or null if the server is not yet listening. */
  readonly getHookToken: () => string | null
}

export class PodController extends Context.Tag('PodController')<PodController, PodControllerShape>() {}

export const PodControllerLive = Layer.effect(
  PodController,
  Effect.gen(function* () {
    const agentStatusSvc = yield* AgentStatusService
    const agentConfigSvc = yield* AgentConfigController
    const db = yield* DatabaseService
    const pty = yield* PtyService
    const crud = yield* PodCrudController
    const containerSvc = yield* PodContainerController
    const lifecycleSvc = yield* PodLifecycleController
    const podItemSvc = yield* PodItemController
    const workenvExec = yield* WorkenvExec
    const workenvCtl = yield* WorkenvController
    // Runtime captured at construction so callback-driven exit handlers can fork
    // cancellable Effects (the restart-on-exit path) back onto it.
    const runtime = yield* Effect.runtime<never>()

    const state = makePodRuntimeState(runtime)
    const {
      ptyMap,
      streamMap,
      containerMap,
      commandStreamMap,
      commandPtyMap,
      transitioning,
      portForwardTunnels,
      withPodLock,
      deletePodLock,
      cancelPendingRestarts,
      cancelAllPendingRestarts,
    } = state

    const terminals = makePodTerminals({
      db,
      pty,
      agentStatusSvc,
      agentConfigSvc,
      containerSvc,
      lifecycleSvc,
      workenvCtl,
      workenvExec,
      state,
      runtime,
    })
    const {
      startPodTerminals,
      stopPodTerminals,
      startSingleTerminal,
      startCommandEffect,
      stopCommandStream,
      destroyWorkenvStream,
    } = terminals

    const persistedPods = listPodsWithContainerId(db)
    for (const p of persistedPods) {
      if (p.containerId) containerMap.set(p.id, p.containerId)
    }

    lifecycleSvc.resetStalePods()

    return {
      // --- Delegate CRUD to PodCrudController ---
      listByWorkspace: (workspaceId) => crud.listByWorkspace(workspaceId),
      listByWorkenv: (workenvId) => Effect.sync(() => listPodsByWorkenv(db, workenvId)),
      countByStatus: (status) => Effect.sync(() => countPodsByStatus(db, status)),
      getById: (id) => crud.getById(id),
      create: (input) => crud.create(input),
      update: (id, input) => crud.update(id, input),
      setWorkenv: (id, workenvId) => Effect.sync(() => setPodWorkenv(db, id, workenvId)),
      setGitContext: (id, gitContext) => Effect.sync(() => setPodGitContext(db, id, gitContext)),

      delete: (id) =>
        withPodLock(
          id,
          Effect.gen(function* () {
            log.pod.debug(`delete: starting pod=${id}`)
            transitioning.add(id)
            const pod = getPodById(db, id)
            cancelPendingRestarts(id)
            try {
              const stopResult = yield* Effect.either(stopPodTerminals(id))
              if (stopResult._tag === 'Left') log.pod.warn(`delete: stopPodTerminals failed pod=${id}`, stopResult.left)
              const destroyResult = yield* Effect.either(
                containerSvc.destroyContainer({
                  podId: id,
                  containerMap,
                  portForwardTunnels,
                  targetManager: state.targetManager,
                }),
              )
              if (destroyResult._tag === 'Left')
                log.pod.warn(`delete: destroyPodContainer failed pod=${id}`, destroyResult.left)
              if (pod?.workenvId) {
                const attachedPods = listPodsByWorkenv(db, pod.workenvId)
                if (attachedPods.every((p) => p.id === id)) {
                  const workenvDestroy = yield* Effect.either(workenvCtl.destroy(pod.workenvId, { withVolumes: true }))
                  if (workenvDestroy._tag === 'Left') {
                    log.pod.warn(
                      `delete: destroy attached workenv failed pod=${id} workenv=${pod.workenvId}`,
                      workenvDestroy.left,
                    )
                  }
                }
              }
              yield* crud.deletePod(id)
            } finally {
              transitioning.delete(id)
              deletePodLock(id)
            }
          }),
        ),

      duplicate: (id) => crud.duplicate(id),

      addTerminal: (input) => crud.addTerminal(input),
      updateTerminal: (id, input) => crud.updateTerminal(id, input),

      removeTerminal: (id) =>
        Effect.gen(function* () {
          const terminal = getTerminalById(db, id)
          const removeEffect = Effect.gen(function* () {
            const streamId = streamMap.get(id)
            if (streamId && state.targetManager) {
              if (terminal) {
                const pod = getPodById(db, terminal.podId)
                if (pod) {
                  const target = resolveTargetForPod(state.targetManager, pod)
                  const podRuntime = getPodRuntime(pod)
                  if (target && podRuntime?.type !== 'docker') {
                    yield* Effect.promise(() => target.ptyDestroy(streamId))
                  }
                }
              }
              state.targetManager.unregisterStream(streamId)
              streamMap.delete(id)
            }

            const ptyId = ptyMap.get(id)
            if (ptyId) {
              yield* pty.destroy(ptyId)
              ptyMap.delete(id)
            }

            yield* crud.removeTerminal(id)
          })
          // Serialize against the owning pod's lifecycle so a concurrent restart
          // or start cannot re-register a stream for this terminal mid-removal.
          yield* terminal ? withPodLock(terminal.podId, removeEffect) : removeEffect
        }),

      listTerminals: (podId) => crud.listTerminals(podId),

      startTerminal: (podTerminalId) => startSingleTerminal(podTerminalId),

      start: (id) =>
        withPodLock(
          id,
          Effect.gen(function* () {
            const pod = getPodById(db, id)
            if (!pod) {
              log.pod.info(`start: pod ${id} not found`)
              return
            }

            log.pod.info(`start: pod ${id} status=${pod.status}, transitioning=${transitioning.has(id)}`)

            if (pod.status === 'running' || pod.status === 'starting' || transitioning.has(id)) return
            transitioning.add(id)

            lifecycleSvc.setPodStatus(id, 'starting')

            try {
              const result = yield* Effect.exit(startPodTerminals(id))

              if (result._tag === 'Failure') {
                const cause = result.cause
                const msg =
                  cause._tag === 'Die'
                    ? String(cause.defect)
                    : cause._tag === 'Fail'
                      ? String(cause.error)
                      : 'Unknown error'
                log.pod.error(`start pod ${id} failed:`, msg)
                lifecycleSvc.setPodStatus(id, 'failed')
                return yield* Effect.fail(new Error(msg))
              }

              const { succeeded, failed, total, reason } = result.value
              log.pod.info(`start pod ${id}: succeeded=${succeeded}, failed=${failed}, total=${total}`)

              if (total === 0) {
                lifecycleSvc.setPodStatus(id, 'running')
                containerSvc.discoverGitContext({ podId: id, containerMap, targetManager: state.targetManager })
              } else if (succeeded === 0 && failed > 0) {
                const failReason = reason ?? 'All terminals failed to start'
                lifecycleSvc.setPodStatus(id, 'failed')
                return yield* Effect.fail(new Error(failReason))
              } else if (succeeded > 0) {
                lifecycleSvc.setPodStatus(id, 'running')
                containerSvc.discoverGitContext({ podId: id, containerMap, targetManager: state.targetManager })
              }

              const autoStartCmds = listCommandsByPod(db, id).filter((c) => c.autoStart)
              for (const cmd of autoStartCmds) {
                yield* startCommandEffect(cmd.id).pipe(Effect.catchAll(() => Effect.succeed(null)))
              }
            } finally {
              transitioning.delete(id)
            }
          }),
        ),

      ensureStarted: (id) =>
        withPodLock(
          id,
          Effect.gen(function* () {
            const pod = getPodById(db, id)
            if (!pod) return
            // Idempotent: already running / starting / in-flight → no-op.
            // This is the only path heavyweight agents should start through
            // post-launch, so it handles local PTY and container-backed pods
            // alike. Concurrent callers serialize on the pod lock and the
            // status re-read below makes the second a no-op.
            if (pod.status === 'running' || pod.status === 'starting' || transitioning.has(id)) return
            transitioning.add(id)
            lifecycleSvc.setPodStatus(id, 'starting')
            try {
              const result = yield* Effect.exit(startPodTerminals(id))
              if (result._tag === 'Failure') {
                lifecycleSvc.setPodStatus(id, 'failed')
                return
              }
              const { succeeded, total } = result.value
              lifecycleSvc.setPodStatus(id, total === 0 || succeeded > 0 ? 'running' : 'failed')
              if (succeeded > 0) {
                containerSvc.discoverGitContext({ podId: id, containerMap, targetManager: state.targetManager })
              }
            } finally {
              transitioning.delete(id)
            }
          }),
        ),

      ensureAllLocalStarted: () =>
        Effect.gen(function* () {
          const allPods = getAllPods(db)
          const candidates = allPods.filter(
            (p) =>
              lifecycleSvc.isLocalPty(p) &&
              p.status !== 'running' &&
              p.status !== 'starting' &&
              !transitioning.has(p.id),
          )

          if (candidates.length === 0) {
            return { started: 0, skipped: allPods.length, failed: 0 }
          }

          log.pod.info(`ensureAllLocalStarted: starting ${candidates.length} local pod(s)`)

          const results = yield* Effect.all(
            candidates.map((p) =>
              withPodLock(
                p.id,
                Effect.gen(function* () {
                  // Re-check under the lock: a concurrent ensureStarted may have
                  // already taken this pod between the candidate scan and here.
                  const current = getPodById(db, p.id)
                  if (
                    !current ||
                    current.status === 'running' ||
                    current.status === 'starting' ||
                    transitioning.has(p.id)
                  ) {
                    return 'skipped' as const
                  }
                  transitioning.add(p.id)
                  lifecycleSvc.setPodStatus(p.id, 'starting')
                  try {
                    const exit = yield* Effect.exit(startPodTerminals(p.id))
                    if (exit._tag === 'Failure') {
                      lifecycleSvc.setPodStatus(p.id, 'failed')
                      return 'failed' as const
                    }
                    const { succeeded, total } = exit.value
                    const ok = total === 0 || succeeded > 0
                    lifecycleSvc.setPodStatus(p.id, ok ? 'running' : 'failed')
                    if (succeeded > 0) {
                      containerSvc.discoverGitContext({ podId: p.id, containerMap, targetManager: state.targetManager })
                    }
                    return ok ? ('started' as const) : ('failed' as const)
                  } finally {
                    transitioning.delete(p.id)
                  }
                }),
              ),
            ),
            { concurrency: 'unbounded' },
          )

          const started = results.filter((r) => r === 'started').length
          const failed = results.filter((r) => r === 'failed').length
          const skippedUnderLock = results.filter((r) => r === 'skipped').length
          log.pod.info(`ensureAllLocalStarted complete: started=${started}, failed=${failed}`)
          return { started, skipped: allPods.length - candidates.length + skippedUnderLock, failed }
        }),

      stop: (id) =>
        withPodLock(
          id,
          Effect.gen(function* () {
            const pod = getPodById(db, id)
            if (!pod) return

            if (pod.status === 'stopped' || pod.status === 'stopping' || transitioning.has(id)) return
            transitioning.add(id)

            lifecycleSvc.setPodStatus(id, 'stopping')
            cancelPendingRestarts(id)

            try {
              yield* stopPodTerminals(id)
              lifecycleSvc.setPodStatus(id, 'stopped')
            } finally {
              transitioning.delete(id)
            }
          }),
        ),

      restart: (id) =>
        withPodLock(
          id,
          Effect.gen(function* () {
            if (transitioning.has(id)) return
            transitioning.add(id)

            try {
              lifecycleSvc.setPodStatus(id, 'starting')
              cancelPendingRestarts(id)

              yield* stopPodTerminals(id)

              const pod = getPodById(db, id)
              if (!pod) return

              const result = yield* Effect.exit(startPodTerminals(id))

              if (result._tag === 'Failure') {
                const cause = result.cause
                const msg =
                  cause._tag === 'Die'
                    ? String(cause.defect)
                    : cause._tag === 'Fail'
                      ? String(cause.error)
                      : 'Unknown error'
                log.pod.error(`restart pod ${id} failed:`, msg)
                lifecycleSvc.setPodStatus(id, 'failed')
                return
              }

              const { succeeded, failed, total } = result.value

              if (total === 0) {
                lifecycleSvc.setPodStatus(id, 'running')
              } else if (succeeded === 0 && failed > 0) {
                lifecycleSvc.setPodStatus(id, 'failed')
              } else if (succeeded > 0) {
                lifecycleSvc.setPodStatus(id, 'running')
              }
            } finally {
              transitioning.delete(id)
            }
          }),
        ),

      stopAllForWorkspace: (workspaceId) =>
        Effect.gen(function* () {
          const workspacePods = listPodsByWorkspace(db, workspaceId)
          for (const pod of workspacePods) {
            if (pod.status === 'running' || pod.status === 'starting') {
              yield* stopPodTerminals(pod.id)
              lifecycleSvc.setPodStatus(pod.id, 'stopped')
            }
          }
        }),

      stopAll: () =>
        Effect.gen(function* () {
          const running = listRunningPods(db)
          let stopped = 0
          for (const pod of running) {
            const didStop = yield* withPodLock(
              pod.id,
              Effect.gen(function* () {
                if (transitioning.has(pod.id)) return false
                transitioning.add(pod.id)
                lifecycleSvc.setPodStatus(pod.id, 'stopping')
                cancelPendingRestarts(pod.id)
                try {
                  yield* stopPodTerminals(pod.id)
                  lifecycleSvc.setPodStatus(pod.id, 'stopped')
                  return true
                } finally {
                  transitioning.delete(pod.id)
                }
              }),
            )
            if (didStop) stopped++
          }
          return stopped
        }),

      setActiveView: (podId, viewId) => crud.setActiveView(podId, viewId),
      isWandaMcpEnabled: (podId) => Effect.sync(() => resolveWandaMcpEnabledForPod(db, podId)),

      runningTerminals: (podId) =>
        Effect.sync(() => {
          const terminalRows = listTerminalsByPod(db, podId)
          return terminalRows
            .filter((t) => ptyMap.has(t.id) || streamMap.has(t.id))
            .map((t) => ({
              podTerminalId: t.id,
              ptyInstanceId: ptyMap.get(t.id) ?? streamMap.get(t.id)!,
              name: t.name,
            }))
        }),

      recoverContainers: () =>
        Effect.gen(function* () {
          let recovered = 0
          let recoveryFailed = 0

          if (!state.targetManager) return { recovered, failed: recoveryFailed }
          const entries = [...containerMap.entries()]
          if (entries.length === 0) return { recovered, failed: recoveryFailed }
          log.pod.info(`recoverContainers: ${entries.length} persisted container(s)`)

          for (const [podId, containerId] of entries) {
            const pod = getPodById(db, podId)
            if (!pod) {
              containerMap.delete(podId)
              clearPodContainerState(db, podId)
              continue
            }

            const target = resolveTargetForPod(state.targetManager, pod)
            if (!target) {
              log.pod.info(`recoverContainers: target unavailable for pod ${podId}, skipping`)
              continue
            }

            if (target.status !== 'connected') {
              log.pod.info(`recoverContainers: target not connected (${target.status}), skipping pod ${podId}`)
              continue
            }

            try {
              const info = yield* Effect.promise(() => target.dockerInspectContainer(containerId))
              if (!info) {
                log.pod.info(`recoverContainers: container ${containerId} not found, clearing`)
                containerMap.delete(podId)
                clearPodContainerState(db, podId)
              } else if (info.state === 'running') {
                // Rebind DB state to the still-running container, but do NOT
                // spawn terminals / agent processes. Agents (claude, codex,
                // etc.) can be multi-GB each during startup — spawning N at
                // once on launch stampedes memory. `usePodLifecycle` triggers
                // `ensureStarted` when the user opens the pod's view, so
                // heavy processes only materialise for pods they look at.
                log.pod.info(
                  `recoverContainers: container ${containerId} still running, marking pod ${podId} as stopped (lazy start)`,
                )
                lifecycleSvc.setPodStatus(podId, 'stopped')
                recovered++
              } else {
                log.pod.info(`recoverContainers: container ${containerId} state=${info.state}, keeping for reuse`)
              }
            } catch (err) {
              log.pod.error(`recoverContainers: error inspecting container ${containerId}:`, err)
              recoveryFailed++
            }
          }

          log.pod.info(`recoverContainers complete: recovered=${recovered}, failed=${recoveryFailed}`)
          return { recovered, failed: recoveryFailed }
        }),

      shutdown: async () => {
        cancelAllPendingRestarts()

        if (containerMap.size > 0) log.pod.info(`shutdown: stopping ${containerMap.size} container(s)`)
        else log.pod.debug('shutdown: stopping 0 container(s)')
        const globalLifecycle = getContainerLifecycleDefault(db)
        const entries = [...containerMap.entries()]
        for (const [podId] of entries) {
          try {
            const pod = getPodById(db, podId)
            if (!pod) continue

            const target = resolveTargetForPod(state.targetManager, pod)
            if (!target) continue

            const lifecycle = containerSvc.resolveLifecycle(pod.containerLifecycle, globalLifecycle)

            const terminalRows = listTerminalsByPod(db, podId)
            for (const terminal of terminalRows) {
              const streamId = streamMap.get(terminal.id)
              if (streamId && state.targetManager) {
                const podRuntime = getPodRuntime(pod)
                if (podRuntime?.type !== 'docker') {
                  try {
                    await target.ptyDestroy(streamId)
                  } catch (err) {
                    log.pod.warn(`shutdown: ptyDestroy failed for stream ${streamId}:`, err)
                  }
                }
                state.targetManager.unregisterStream(streamId)
                streamMap.delete(terminal.id)
              }
              const ptyId = ptyMap.get(terminal.id)
              if (ptyId) {
                try {
                  await Effect.runPromise(pty.destroy(ptyId))
                } catch (err) {
                  log.pod.warn(`shutdown: pty.destroy failed for ${ptyId}:`, err)
                }
                ptyMap.delete(terminal.id)
              }
            }

            if (lifecycle === 'stop-on-exit') {
              const containerId = containerMap.get(podId)
              if (containerId) {
                try {
                  await target.dockerStopContainer(containerId, 5)
                } catch (err) {
                  log.pod.warn(`shutdown: dockerStopContainer failed for ${containerId}:`, err)
                }
              }
              containerMap.delete(podId)
              markPodStoppedAndClearContainer(db, podId)
            } else {
              lifecycleSvc.setPodStatus(podId, 'stopped')
            }
          } catch (err) {
            log.pod.error(`shutdown: error stopping pod ${podId}:`, err)
          }
        }

        for (const [terminalId, streamId] of [...streamMap.entries()]) {
          const terminal = getTerminalById(db, terminalId)
          const pod = terminal ? getPodById(db, terminal.podId) : undefined
          if (!pod?.workenvId || getPodRuntime(pod)?.type === 'docker') continue
          try {
            destroyWorkenvStream(streamId)
          } catch (err) {
            log.pod.warn(`shutdown: workenv exec destroy failed for stream ${streamId}:`, err)
          }
          streamMap.delete(terminalId)
        }
      },

      streamToPodId: (streamId) => {
        for (const [terminalId, sid] of streamMap) {
          if (sid === streamId) {
            const terminal = getTerminalById(db, terminalId)
            return terminal?.podId
          }
        }
        for (const [cmdId, sid] of commandStreamMap) {
          if (sid === streamId) {
            const cmd = getCommandById(db, cmdId)
            return cmd?.podId
          }
        }
        return undefined
      },

      streamToTerminalId: (streamId) => {
        for (const [terminalId, sid] of streamMap) {
          if (sid === streamId) return terminalId
        }
        for (const [terminalId, pid] of ptyMap) {
          if (pid === streamId) return terminalId
        }
        return undefined
      },

      terminalToPodId: (terminalId) => {
        const terminal = getTerminalById(db, terminalId)
        return terminal?.podId
      },

      isCommandStream: (streamId) => {
        for (const sid of commandStreamMap.values()) {
          if (sid === streamId) return true
        }
        return false
      },

      // --- Agent CRUD (delegates to PodCrudController) ---

      addAgent: (input) => crud.addAgent(input),
      removeAgent: (podAgentId) =>
        Effect.gen(function* () {
          const agent = getAgentById(db, podAgentId)
          if (agent && (ptyMap.has(agent.podTerminalId) || streamMap.has(agent.podTerminalId))) {
            const streamId = streamMap.get(agent.podTerminalId) ?? ptyMap.get(agent.podTerminalId)
            if (streamId && state.targetManager) {
              const terminal = getTerminalById(db, agent.podTerminalId)
              if (terminal) {
                const pod = getPodById(db, terminal.podId)
                if (pod) {
                  const target = resolveTargetForPod(state.targetManager, pod)
                  if (target) {
                    yield* Effect.tryPromise(() => target.ptyDestroy(streamId)).pipe(
                      Effect.catchAll((err) => {
                        log.pod.warn(`ptyDestroy failed for stream ${streamId}:`, err)
                        return Effect.void
                      }),
                    )
                  }
                }
              }
            }
            ptyMap.delete(agent.podTerminalId)
            streamMap.delete(agent.podTerminalId)
          }
          yield* crud.removeAgent(podAgentId)
        }),
      listAgents: (podId) => crud.listAgents(podId),
      runningAgents: (podId) =>
        Effect.sync(() => {
          const agents = listAgentsByPod(db, podId)
          return agents
            .filter((a) => ptyMap.has(a.podTerminalId) || streamMap.has(a.podTerminalId))
            .map((a) => {
              const terminal = getTerminalById(db, a.podTerminalId)
              return {
                podAgentId: a.id,
                podTerminalId: a.podTerminalId,
                ptyInstanceId: ptyMap.get(a.podTerminalId) ?? streamMap.get(a.podTerminalId)!,
                name: terminal?.name ?? 'Agent',
                agentType: a.agentType,
              }
            })
        }),

      // --- Command CRUD + lifecycle ---

      addCommand: (input) => crud.addCommand(input),
      importCommands: (podId, commands) => crud.importCommands(podId, commands),
      updateCommand: (id, input) => crud.updateCommand(id, input),
      removeCommand: (id) =>
        Effect.gen(function* () {
          const sid = commandStreamMap.get(id) ?? commandPtyMap.get(id)
          if (sid) {
            yield* stopCommandStream(id)
          }
          yield* crud.removeCommand(id)
        }),
      listCommands: (podId) => crud.listCommands(podId),

      startCommand: (podCommandId) => startCommandEffect(podCommandId),

      stopCommand: (podCommandId) => stopCommandStream(podCommandId),

      restartCommand: (podCommandId) =>
        Effect.gen(function* () {
          yield* stopCommandStream(podCommandId)
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 200)))
          yield* startCommandEffect(podCommandId)
        }),

      runningCommands: (podId) =>
        Effect.sync(() => {
          const cmds = listCommandsByPod(db, podId)
          return cmds
            .filter((c) => commandStreamMap.has(c.id) || commandPtyMap.has(c.id))
            .map((c) => ({
              podCommandId: c.id,
              ptyInstanceId: commandStreamMap.get(c.id) ?? commandPtyMap.get(c.id)!,
              name: c.name,
            }))
        }),

      // --- Tag CRUD ---
      listTags: (podId) => crud.listTags(podId),
      createTag: (podId, name) => crud.createTag(podId, name),
      deleteTag: (id) => crud.deleteTag(id),
      tagCommand: (commandId, tagId) => crud.tagCommand(commandId, tagId),
      untagCommand: (commandId, tagId) => crud.untagCommand(commandId, tagId),

      addCommandToView: (podCommandId) =>
        Effect.gen(function* () {
          const cmd = getCommandById(db, podCommandId)
          if (!cmd) return
          const items = yield* podItemSvc.listByPod(cmd.podId)
          const existing = items.find(
            (i) => i.contentType === 'command' && 'podCommandId' in i.config && i.config.podCommandId === podCommandId,
          )
          if (existing) return
          yield* podItemSvc.create({
            podId: cmd.podId,
            contentType: 'command',
            label: cmd.name,
            config: { podCommandId },
          })
        }),

      setTargetManager: (tm) => {
        state.targetManager = tm
      },

      setHttpPort: (port) => {
        state.httpPort = port
      },

      getHttpPort: () => state.httpPort,

      setHookToken: (token) => {
        state.hookToken = token
      },

      getHookToken: () => state.hookToken,
    }
  }),
)
