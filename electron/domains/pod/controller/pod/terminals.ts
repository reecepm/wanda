import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { type Context, Effect, Either, Runtime } from 'effect'
import { LABEL_PREFIX } from '../../../../app-config'
import type { AppDatabase } from '../../../../db/connection'
import type { AgentStatusService } from '../../../../packages/agent-hooks'
import { buildAgentTerminalMcpArgs, resolveWandaMcpEnabledForPod } from '../../../../packages/agent-mcp'
import { log } from '../../../../packages/logger'
import { removePodFromSshConfig } from '../../../../packages/ssh'
import { AppError } from '../../../../services/errors'
import type { PtyService } from '../../../../services/pty.service'
import { type AgentConfigController, buildAgentConfigArgs } from '../../../settings'
import type { WorkenvController, WorkenvExec } from '../../../workenv'
import {
  getAgentByTerminalId,
  getCommandById,
  getPodById,
  getTerminalById,
  listAgentTerminalTypesByPod,
  listCommandsByPod,
  listTerminalsByPod,
  type PodCommandRow,
  type PodRow,
  setPodContainerId,
} from '../../repository'
import type { AgentType, PodRuntime } from '../../types'
import { getPodRuntime, isLocalPty, type PodContainerController, resolveTargetForPod } from '../container'
import type { PodLifecycleController } from '../lifecycle'
import { buildAgentTerminalEnv, claudeHookUrl, injectAgentHooks } from './agent-env'
import type { PodRuntimeState } from './state'
import { makeWorkenvAttach } from './workenv-attach'

const TERMINAL_RESTART_DELAY_MS = 1_000

/** A lifecycle operation found the pod removed or no longer running mid-flight. */
class PodNoLongerRunnable extends AppError('PodNoLongerRunnable', 'CONFLICT')<{
  readonly podId: string
}> {}

/** Merge nullable env records into a single Record<string, string>. */
function mergeEnv(...sources: (Record<string, string> | null | undefined)[]): Record<string, string> {
  return Object.assign({}, ...sources) as Record<string, string>
}

const ANSI_PATTERN =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping intentionally matches ESC/BEL bytes.
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g

export interface PodTerminalsDeps {
  readonly db: AppDatabase
  readonly pty: Context.Tag.Service<typeof PtyService>
  readonly agentStatusSvc: Context.Tag.Service<typeof AgentStatusService>
  readonly agentConfigSvc: Context.Tag.Service<typeof AgentConfigController>
  readonly containerSvc: Context.Tag.Service<typeof PodContainerController>
  readonly lifecycleSvc: Context.Tag.Service<typeof PodLifecycleController>
  readonly workenvCtl: Context.Tag.Service<typeof WorkenvController>
  readonly workenvExec: Context.Tag.Service<typeof WorkenvExec>
  readonly state: PodRuntimeState
  readonly runtime: Runtime.Runtime<never>
}

/** Terminal / command process orchestration for the pod controller. */
export interface PodTerminals {
  readonly startPodTerminals: (
    podId: string,
  ) => Effect.Effect<{ succeeded: number; failed: number; total: number; reason?: string }>
  readonly stopPodTerminals: (podId: string) => Effect.Effect<void>
  readonly startSingleTerminal: (podTerminalId: string) => Effect.Effect<{ ptyInstanceId: string } | null>
  readonly checkAllExited: (podId: string) => void
  readonly startCommandEffect: (podCommandId: string) => Effect.Effect<{ ptyInstanceId: string } | null>
  readonly stopCommandStream: (podCommandId: string) => Effect.Effect<void>
  /** Tear down a workenv exec stream (used by shutdown). */
  readonly destroyWorkenvStream: (streamId: string) => void
}

export function makePodTerminals(deps: PodTerminalsDeps): PodTerminals {
  const { db, pty, agentStatusSvc, agentConfigSvc, containerSvc, lifecycleSvc, state, runtime } = deps
  // Workenv-attached terminals route through here. The exit handler lives in
  // this module (handleTerminalExit), so the attach helper is wired locally.
  const workenv = makeWorkenvAttach(state, deps.workenvCtl, deps.workenvExec, (terminalId, podId, code) =>
    handleTerminalExit(terminalId, podId, code),
  )
  const {
    ptyMap,
    streamMap,
    containerMap,
    commandStreamMap,
    commandPtyMap,
    transitioning,
    portForwardTunnels,
    hookCleanups,
    withPodLock,
    trackRestart,
    untrackRestart,
  } = state

  /**
   * Fetch the tail of an agent terminal's scrollback, strip ANSI, and push
   * it to the AgentStatusService so the renderer's stopped view can show
   * the last output (usually the CLI's own error message).
   */
  async function captureAgentExitOutput(
    terminalId: string,
    exitedPtyId: string | undefined,
    exitedStreamId: string | undefined,
  ): Promise<void> {
    try {
      let raw = ''
      if (exitedStreamId && state.targetManager) {
        raw = await state.targetManager.getScrollback(exitedStreamId)
      } else if (exitedPtyId) {
        raw = await pty.getScrollbackAsync(exitedPtyId)
      }
      if (!raw) return
      const cleaned = raw.replace(ANSI_PATTERN, '').replace(/\r/g, '').trimEnd()
      if (!cleaned) return
      // Cap to the last ~2KB / 30 lines — enough to capture an error block.
      const byteTail = cleaned.length > 2048 ? cleaned.slice(-2048) : cleaned
      const lines = byteTail.split('\n')
      const lineTail = lines.length > 30 ? lines.slice(-30).join('\n') : byteTail
      agentStatusSvc.markStopped(terminalId, { exitOutput: lineTail })
    } catch (err) {
      log.pod.warn(`captureAgentExitOutput failed for ${terminalId}:`, err)
    }
  }

  function handleTerminalExit(terminalId: string, podId: string, exitCode: number) {
    // Capture the backing id before we drop it from the maps — we need it
    // to fetch the final scrollback for agent exit diagnostics.
    const exitedPtyId = ptyMap.get(terminalId)
    const exitedStreamId = streamMap.get(terminalId)
    ptyMap.delete(terminalId)
    streamMap.delete(terminalId)

    const terminal = getTerminalById(db, terminalId)
    const pod = getPodById(db, podId)
    if (!terminal || !pod || pod.status !== 'running') {
      setTimeout(() => checkAllExited(podId), 0)
      return
    }

    // Agent terminals: never restart or fall back to shell — just mark stopped
    const agent = getAgentByTerminalId(db, terminalId)
    if (agent) {
      log.pod.info(`Agent ${agent.agentType} (${agent.id}) stopped with exit code ${exitCode}`)
      // Flip status immediately so the UI can react, then enrich with the
      // tail of scrollback so the view can explain *why* the CLI exited
      // (rate limit, auth expired, context overflow, etc.).
      agentStatusSvc.markStopped(terminalId, { exitCode })
      void captureAgentExitOutput(terminalId, exitedPtyId, exitedStreamId)
      setTimeout(() => checkAllExited(podId), 0)
      return
    }

    const policy = terminal.restartPolicy ?? 'never'
    const shouldRestart = policy === 'always' || (policy === 'on-failure' && exitCode !== 0)
    if (!shouldRestart) {
      setTimeout(() => checkAllExited(podId), 0)
      return
    }

    // Don't restart if pod is being stopped/deleted
    if (transitioning.has(podId)) {
      log.pod.info(`Skipping restart for terminal ${terminalId}: pod ${podId} is transitioning`)
      setTimeout(() => checkAllExited(podId), 0)
      return
    }

    log.pod.info(`Restarting terminal ${terminalId} (policy=${policy}, exitCode=${exitCode})`)
    scheduleTerminalRestart(terminalId, podId)
  }

  /**
   * Restart a terminal after its exit, Effect-natively. The whole sleep →
   * re-validate → create → register sequence runs inside the pod's lock, so a
   * concurrent `stop`/`delete` cannot tear the pod down between us spawning a
   * process and recording it in the maps (which would orphan it). The work is
   * a forked, interruptible fiber tracked in `pendingRestarts`; cancelling the
   * pod's pending restarts interrupts it — during the sleep, or while it is
   * queued on the lock behind the in-flight teardown — before any process is
   * created.
   */
  function scheduleTerminalRestart(terminalId: string, podId: string) {
    const restartEffect = Effect.gen(function* () {
      yield* Effect.sleep(TERMINAL_RESTART_DELAY_MS)
      yield* withPodLock(
        podId,
        Effect.gen(function* () {
          const currentPod = getPodById(db, podId)
          const terminal = getTerminalById(db, terminalId)
          if (!currentPod || !terminal || currentPod.status !== 'running' || transitioning.has(podId)) {
            return yield* new PodNoLongerRunnable({ podId, message: `pod ${podId} no longer runnable for restart` })
          }

          const podRuntime = getPodRuntime(currentPod)
          if (currentPod.workenvId && podRuntime?.type !== 'docker') {
            yield* workenv.ensureReadyForTerminal(podId, currentPod.workenvId)
            yield* workenv.startTerminal(podId, currentPod.workenvId, terminalId, {
              cmd: terminal.command ?? currentPod.shell ?? '/bin/sh',
              args: terminal.args ?? undefined,
              env: mergeEnv(currentPod.env, terminal.env),
              cwd: currentPod.cwd,
              pty: true,
            })
            return
          }

          const target = resolveTargetForPod(state.targetManager, currentPod)
          if (!target || target.status !== 'connected') {
            return yield* new PodNoLongerRunnable({ podId, message: `pod ${podId} target unavailable for restart` })
          }
          const streamId = yield* Effect.tryPromise(() =>
            target.ptyCreate({
              cwd: currentPod.cwd,
              command: terminal.command ?? currentPod.shell ?? undefined,
              args: terminal.args ?? undefined,
              env: mergeEnv(currentPod.env, terminal.env),
            }),
          )
          streamMap.set(terminalId, streamId)
          state.targetManager!.registerStream(streamId, target.id)
          target.onStreamExit(streamId, (code) => handleTerminalExit(terminalId, podId, code))
        }),
      )
    }).pipe(
      Effect.catchAll((err) =>
        Effect.sync(() => {
          if (err instanceof PodNoLongerRunnable) {
            log.pod.info(`Skipping restart for terminal ${terminalId}: ${err.message}`)
          } else {
            log.pod.error(`Restart failed for terminal ${terminalId}:`, err)
          }
          checkAllExited(podId)
        }),
      ),
    )

    const fiber = Runtime.runFork(runtime)(restartEffect)
    trackRestart(podId, fiber)
    fiber.addObserver(() => untrackRestart(podId, fiber))
  }

  function checkAllExited(podId: string) {
    const pod = getPodById(db, podId)
    if (!pod || pod.status !== 'running') return
    // Local PTY pods are perma-running — never auto-stop them
    if (isLocalPty(pod)) return
    const terminals = listTerminalsByPod(db, podId)
    // No terminals left means all items were removed (not that they exited) — don't auto-stop
    if (terminals.length === 0) return
    const anyRunning = terminals.some((t) => ptyMap.has(t.id) || streamMap.has(t.id))
    if (!anyRunning) {
      lifecycleSvc.setPodStatus(podId, 'stopped')
    }
  }

  function stopCommandStream(podCommandId: string): Effect.Effect<void> {
    return Effect.gen(function* () {
      const streamId = commandStreamMap.get(podCommandId)
      const ptyId = commandPtyMap.get(podCommandId)
      if (streamId && state.targetManager) {
        const cmd = getCommandById(db, podCommandId)
        if (cmd) {
          const pod = getPodById(db, cmd.podId)
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
        commandStreamMap.delete(podCommandId)
      } else if (ptyId) {
        yield* pty.destroy(ptyId)
        commandPtyMap.delete(podCommandId)
      }
    })
  }

  function startCommandEffect(podCommandId: string): Effect.Effect<{ ptyInstanceId: string } | null> {
    return Effect.gen(function* () {
      if (commandStreamMap.has(podCommandId) || commandPtyMap.has(podCommandId)) {
        return { ptyInstanceId: commandStreamMap.get(podCommandId) ?? commandPtyMap.get(podCommandId)! }
      }

      const cmd = getCommandById(db, podCommandId)
      if (!cmd) return null

      const pod = getPodById(db, cmd.podId)
      if (!pod || pod.status !== 'running') return null

      const podRuntime = getPodRuntime(pod)
      const commandCwd = resolveCommandCwd(pod, cmd, podRuntime)

      if (state.targetManager) {
        const target = resolveTargetForPod(state.targetManager, pod)
        if (!target || target.status !== 'connected') return null

        if (podRuntime?.type === 'docker') {
          const containerId = containerMap.get(pod.id)
          if (!containerId) return null

          const mergedEnv = mergeEnv({ TERM: 'xterm-256color', USER: 'root', HOME: '/root' }, podRuntime.env, pod.env)
          const execCmd = ['/bin/sh', '-c', cmd.command]

          const execResult = yield* Effect.either(
            Effect.tryPromise(() =>
              target.dockerExec({
                containerId,
                cmd: execCmd,
                env: mergedEnv,
                workDir: commandCwd,
              }),
            ),
          )
          if (Either.isLeft(execResult)) return null
          const streamId = execResult.right
          commandStreamMap.set(podCommandId, streamId)
          state.targetManager.registerStream(streamId, target.id)
          target.onStreamExit(streamId, () => {
            commandStreamMap.delete(podCommandId)
          })
          return { ptyInstanceId: streamId }
        }

        const streamResult = yield* Effect.either(
          Effect.promise(() =>
            target.ptyCreate({
              cwd: commandCwd,
              command: '/bin/sh',
              args: ['-c', cmd.command],
              env: mergeEnv(pod.env),
            }),
          ),
        )
        if (Either.isLeft(streamResult)) {
          log.pod.warn(`startCommand failed for ${podCommandId} in ${commandCwd}:`, streamResult.left)
          return null
        }
        const streamId = streamResult.right
        commandStreamMap.set(podCommandId, streamId)
        state.targetManager.registerStream(streamId, target.id)
        target.onStreamExit(streamId, () => {
          commandStreamMap.delete(podCommandId)
        })
        return { ptyInstanceId: streamId }
      }

      // Legacy direct PTY path
      if (!isDirectory(commandCwd)) {
        log.pod.warn(`startCommand skipped for ${podCommandId}: cwd does not exist (${commandCwd})`)
        return null
      }
      const instanceResult = yield* Effect.either(
        pty.create({
          cwd: commandCwd,
          command: '/bin/sh',
          args: ['-c', cmd.command],
          env: pod.env ?? undefined,
          onExit: () => {
            commandPtyMap.delete(podCommandId)
          },
        }),
      )
      if (Either.isLeft(instanceResult)) {
        log.pod.warn(`startCommand failed for ${podCommandId} in ${commandCwd}:`, instanceResult.left)
        return null
      }
      const instanceId = instanceResult.right
      commandPtyMap.set(podCommandId, instanceId)
      return { ptyInstanceId: instanceId }
    })
  }

  function resolveCommandCwd(pod: PodRow, cmd: PodCommandRow, podRuntime: PodRuntime | null): string {
    if (!cmd.directory) return podRuntime?.type === 'docker' ? (podRuntime.workDir ?? '/workspace') : pod.cwd
    if (cmd.directoryMode !== 'relative') return cmd.directory
    if (podRuntime?.type === 'docker') return path.posix.resolve(podRuntime.workDir ?? '/workspace', cmd.directory)
    return path.resolve(pod.cwd, cmd.directory)
  }

  function isDirectory(cwd: string): boolean {
    try {
      return existsSync(cwd) && statSync(cwd).isDirectory()
    } catch {
      return false
    }
  }

  function stopPodTerminals(podId: string): Effect.Effect<void> {
    return Effect.gen(function* () {
      const cmds = listCommandsByPod(db, podId)
      for (const cmd of cmds) {
        if (commandStreamMap.has(cmd.id) || commandPtyMap.has(cmd.id)) {
          yield* stopCommandStream(cmd.id)
        }
      }

      const terminals = listTerminalsByPod(db, podId)
      const pod = getPodById(db, podId)
      const target = resolveTargetForPod(state.targetManager, pod ?? null)

      for (const terminal of terminals) {
        agentStatusSvc.unregister(terminal.id)

        const streamId = streamMap.get(terminal.id)
        if (streamId && pod?.workenvId && getPodRuntime(pod)?.type !== 'docker') {
          workenv.destroyStream(streamId)
          streamMap.delete(terminal.id)
          continue
        }

        if (streamId && target) {
          const podRuntime = pod ? getPodRuntime(pod) : null
          if (podRuntime?.type === 'docker') {
            state.targetManager!.unregisterStream(streamId)
          } else {
            yield* Effect.either(Effect.promise(() => target.ptyDestroy(streamId)))
            state.targetManager!.unregisterStream(streamId)
          }
          streamMap.delete(terminal.id)
          continue
        }

        const ptyId = ptyMap.get(terminal.id)
        if (ptyId) {
          yield* pty.destroy(ptyId)
          ptyMap.delete(terminal.id)
        }
      }

      // Stop Docker container but keep it for reuse
      const containerId = containerMap.get(podId)
      if (containerId && target) {
        yield* containerSvc.stopContainer({
          podId,
          containerId,
          target,
          portForwardTunnels,
        })
      } else {
        // Even without a container, close port forwards and clean up
        containerSvc.closePortForwards(podId, target, portForwardTunnels)
      }

      removePodFromSshConfig(podId)

      const cleanups = hookCleanups.get(podId)
      if (cleanups) {
        for (const cleanup of cleanups) {
          try {
            cleanup()
          } catch {
            /* best-effort */
          }
        }
        hookCleanups.delete(podId)
      }
    })
  }

  function startPodTerminals(
    podId: string,
  ): Effect.Effect<{ succeeded: number; failed: number; total: number; reason?: string }> {
    return Effect.gen(function* () {
      const pod = getPodById(db, podId)
      if (!pod) return { succeeded: 0, failed: 0, total: 0 }

      const terminals = listTerminalsByPod(db, podId)
      const agentRows = listAgentTerminalTypesByPod(db, podId)
      const agentTypeByTerminal = new Map(agentRows.map((a) => [a.tid, a.agentType as AgentType]))
      const includeWandaMcp = state.httpPort != null && resolveWandaMcpEnabledForPod(db, podId)

      // Pre-resolve per-terminal args, applying effective agent config overrides.
      const argsByTerminal = new Map<string, string[] | null>()
      for (const t of terminals) {
        let args: string[] | null = t.args ?? null
        const at = agentTypeByTerminal.get(t.id)
        if (at) {
          const resolvedCfg = yield* agentConfigSvc.resolveForPod(podId, at)
          const configuredArgs = buildAgentConfigArgs(at, resolvedCfg)
          if (configuredArgs.length > 0) args = [...(args ?? []), ...configuredArgs]
          if (includeWandaMcp && state.httpPort) {
            args = [...buildAgentTerminalMcpArgs(at, state.httpPort), ...(args ?? [])]
          }
        }
        argsByTerminal.set(t.id, args)
      }
      const argsFor = (terminalId: string): string[] | undefined => argsByTerminal.get(terminalId) ?? undefined

      const agentEnvFor = (terminalId: string, isDocker = false): Record<string, string> | undefined => {
        const agentType = agentTypeByTerminal.get(terminalId)
        if (!agentType) return undefined
        return buildAgentTerminalEnv(state, { terminalId, agentType, isDocker, includeWandaMcp })
      }

      const cleanups: (() => void)[] = []
      const podIsDocker = getPodRuntime(pod)?.type === 'docker'
      const podClaudeHookUrl = claudeHookUrl(state, podIsDocker)
      for (const [tid, agentType] of agentTypeByTerminal) {
        injectAgentHooks(agentStatusSvc, cleanups, {
          terminalId: tid,
          agentType,
          cwd: pod.cwd,
          isDocker: podIsDocker,
          claudeHookUrl: podClaudeHookUrl,
        })
      }
      if (cleanups.length > 0) hookCleanups.set(podId, cleanups)

      let succeeded = 0
      let failed = 0

      const podRuntime = getPodRuntime(pod)

      // --- Workenv-attached path -------------------------------------------
      // Pod terminals split into two routes:
      //   - SHELL terminals → exec inside the workenv VM (orbctl run …).
      //     The user wants their dev tools available there.
      //   - AGENT terminals (claude / codex / opencode) → spawn on the
      //     HOST. The agent talks to the host's auth/credentials and the
      //     worktree is mounted under /mnt/mac inside the VM anyway —
      //     running the agent locally avoids credential plumbing into
      //     every per-pod VM.
      if (pod.workenvId && podRuntime?.type !== 'docker') {
        const vmTerminals = terminals.filter((t) => !agentTypeByTerminal.has(t.id))
        const hostTerminals = terminals.filter((t) => agentTypeByTerminal.has(t.id))

        // VM-bound terminals need the workenv running. Auto-start
        // (incl. bootstrap) so the user can open terminals on a pod
        // whose VM is currently stopped (server restart, fresh creation).
        if (vmTerminals.length > 0) {
          const readyResult = yield* Effect.either(workenv.ensureReadyForTerminal(podId, pod.workenvId))
          if (readyResult._tag === 'Left') {
            log.pod.error(`pod ${podId}: workenv not ready before terminal exec:`, readyResult.left)
            // VM-bound failures don't poison agent terminals — fall
            // through and still try the host path for those.
            failed += vmTerminals.length
            vmTerminals.length = 0
          }
        }

        for (const terminal of vmTerminals) {
          const cmd = terminal.command ?? pod.shell ?? '/bin/sh'
          const args = argsFor(terminal.id)
          const env = mergeEnv(pod.env, terminal.env, agentEnvFor(terminal.id, true))
          const result = yield* Effect.either(
            workenv.startTerminal(podId, pod.workenvId, terminal.id, {
              cmd,
              args,
              env,
              cwd: pod.cwd,
              pty: true,
            }),
          )
          if (result._tag === 'Left') {
            log.pod.error(`workenv exec failed for terminal ${terminal.id}:`, result.left)
            failed++
            continue
          }
          succeeded++
        }

        // Agent terminals run on host. The pod cwd points at the local
        // worktree, so claude/codex see the same files as the editor.
        for (const terminal of hostTerminals) {
          try {
            const termEnv = mergeEnv(pod.env, terminal.env, agentEnvFor(terminal.id))
            const ptyId = yield* pty.create({
              cwd: pod.cwd,
              command: terminal.command ?? pod.shell ?? undefined,
              args: argsFor(terminal.id),
              env: termEnv,
              onExit: (_id, exitCode) => handleTerminalExit(terminal.id, podId, exitCode),
            })
            ptyMap.set(terminal.id, ptyId)
            succeeded++
          } catch (err) {
            log.pod.error(`host PTY create failed for agent terminal ${terminal.id}:`, err)
            failed++
          }
        }

        return { succeeded, failed, total: terminals.length }
      }

      log.pod.info(
        `startPodTerminals: podId=${podId}, runtime=${podRuntime?.type ?? 'none'}, terminals=${terminals.length}`,
      )
      if (state.targetManager) {
        const target = resolveTargetForPod(state.targetManager, pod)
        if (!target) {
          return {
            succeeded: 0,
            failed: terminals.length,
            total: terminals.length,
            reason: 'Failed to resolve target',
          }
        }
        // Wait for target to connect if it's actively connecting
        if (target.status === 'connecting') {
          log.pod.info(`Target ${target.id} connecting, waiting up to 30s...`)
          const connected = yield* Effect.promise(
            () =>
              new Promise<boolean>((resolve) => {
                if (target.status === 'connected') return resolve(true)
                const timeout = setTimeout(() => {
                  unsub()
                  resolve(false)
                }, 30_000)
                const unsub = target.onStatusChange((s) => {
                  if (s === 'connected') {
                    clearTimeout(timeout)
                    unsub()
                    resolve(true)
                  }
                  if (s === 'disconnected') {
                    clearTimeout(timeout)
                    unsub()
                    resolve(false)
                  }
                })
              }),
          )
          if (!connected) {
            const reason = `Target failed to connect (status: ${target.status})`
            log.pod.error(`${reason}, cannot start pod ${podId}`)
            return { succeeded: 0, failed: terminals.length, total: terminals.length, reason }
          }
        } else if (target.status !== 'connected') {
          const reason = `Target is not connected (status: ${target.status})`
          log.pod.error(`${reason}, cannot start pod ${podId}`)
          return { succeeded: 0, failed: terminals.length, total: terminals.length, reason }
        }

        if (podRuntime?.type === 'docker') {
          // --- Docker runtime path (direct, no environment) ---
          let containerId = containerMap.get(podId)
          if (!containerId) {
            const createEnv = podRuntime.env || pod.env ? { ...(podRuntime.env ?? {}), ...(pod.env ?? {}) } : undefined
            // Two-step (create then start) so we can clean the container
            // up if start fails — otherwise dockerd keeps the dangling
            // container around forever.
            const createResult = yield* Effect.either(
              Effect.tryPromise(() =>
                target.dockerCreateContainer({
                  image: podRuntime.image,
                  workDir: podRuntime.workDir ?? pod.cwd,
                  env: createEnv,
                  mounts: podRuntime.mounts,
                  resources: podRuntime.resources,
                  labels: { [`${LABEL_PREFIX}.pod`]: podId },
                  ports: podRuntime.ports,
                }),
              ),
            )
            if (Either.isLeft(createResult)) {
              const err = createResult.left
              return {
                succeeded: 0,
                failed: terminals.length,
                total: terminals.length,
                reason: `Docker container creation failed: ${err instanceof Error ? err.message : String(err)}`,
              }
            }
            const newContainerId = createResult.right
            const startResult = yield* Effect.either(
              Effect.tryPromise(() => target.dockerStartContainer(newContainerId)),
            )
            if (Either.isLeft(startResult)) {
              yield* Effect.either(Effect.tryPromise(() => target.dockerRemoveContainer(newContainerId)))
              const err = startResult.left
              return {
                succeeded: 0,
                failed: terminals.length,
                total: terminals.length,
                reason: `Docker container start failed: ${err instanceof Error ? err.message : String(err)}`,
              }
            }
            containerId = newContainerId
            containerMap.set(podId, containerId)
            setPodContainerId(db, podId, containerId)
          }

          log.pod.info(`Container ready, execing ${terminals.length} terminal(s)...`)

          for (const terminal of terminals) {
            const mergedEnv = mergeEnv(
              {
                TERM: 'xterm-256color',
                USER: 'root',
                HOME: '/root',
                DISABLE_AUTOUPDATER: '1',
                NODE_OPTIONS: '--max-old-space-size=4096',
              },
              podRuntime.env,
              pod.env,
              terminal.env,
              agentEnvFor(terminal.id, true),
            )
            const shell = '/bin/sh'

            let execCmd: string[]
            if (terminal.command) {
              execCmd = [terminal.command, ...(argsFor(terminal.id) ?? [])]
            } else if (mergedEnv.CLAUDE_CODE_OAUTH_TOKEN) {
              const credInit = `mkdir -p /root/.claude && printf '{"claudeAiOauth":{"accessToken":"%s","refreshToken":"%s","expiresAt":"2099-12-31T23:59:59.999Z","scopes":["read","write"],"subscriptionType":"pro"}}' "$CLAUDE_CODE_OAUTH_TOKEN" "$CLAUDE_CODE_OAUTH_TOKEN" > /root/.claude/.credentials.json && chmod 600 /root/.claude/.credentials.json; exec ${shell}`
              execCmd = ['bash', '-c', credInit]
            } else {
              execCmd = [shell]
            }

            const execResult = yield* Effect.either(
              Effect.tryPromise(() =>
                target.dockerExec({
                  containerId,
                  cmd: execCmd,
                  env: mergedEnv,
                  workDir: podRuntime.workDir,
                }),
              ),
            )
            if (Either.isLeft(execResult)) {
              log.pod.error(`Docker exec failed for terminal ${terminal.id}:`, execResult.left)
              failed++
              continue
            }
            const streamId = execResult.right
            log.pod.info(`Exec succeeded for terminal ${terminal.id}, streamId=${streamId}`)
            streamMap.set(terminal.id, streamId)
            state.targetManager!.registerStream(streamId, target.id)
            target.onStreamExit(streamId, (code) => handleTerminalExit(terminal.id, podId, code))
            succeeded++
          }
        } else {
          // --- Target-routed PTY path ---
          for (const terminal of terminals) {
            try {
              const termEnv = mergeEnv(pod.env, terminal.env, agentEnvFor(terminal.id))
              const streamId = yield* Effect.promise(() =>
                target.ptyCreate({
                  cwd: pod.cwd,
                  command: terminal.command ?? pod.shell ?? undefined,
                  args: argsFor(terminal.id),
                  env: termEnv,
                }),
              )
              streamMap.set(terminal.id, streamId)
              state.targetManager!.registerStream(streamId, target.id)
              target.onStreamExit(streamId, (code) => handleTerminalExit(terminal.id, podId, code))
              succeeded++
            } catch (err) {
              log.pod.error(`PTY create failed for terminal ${terminal.id}:`, err)
              failed++
            }
          }
        }
      } else {
        // --- Legacy fallback: direct PtyService ---
        for (const terminal of terminals) {
          try {
            const termEnv = mergeEnv(pod.env, terminal.env, agentEnvFor(terminal.id))
            const ptyId = yield* pty.create({
              cwd: pod.cwd,
              command: terminal.command ?? pod.shell ?? undefined,
              args: argsFor(terminal.id),
              env: termEnv,
              onExit: (_id, exitCode) => handleTerminalExit(terminal.id, podId, exitCode),
            })
            ptyMap.set(terminal.id, ptyId)
            succeeded++
          } catch (err) {
            log.pod.error(`Legacy PTY create failed for terminal ${terminal.id}:`, err)
            failed++
          }
        }
      }

      return { succeeded, failed, total: terminals.length }
    })
  }

  function startSingleTerminal(podTerminalId: string): Effect.Effect<{ ptyInstanceId: string } | null> {
    return Effect.gen(function* () {
      const terminal = getTerminalById(db, podTerminalId)
      if (!terminal) return null

      const pod = getPodById(db, terminal.podId)
      if (!pod || pod.status !== 'running') return null

      if (ptyMap.has(terminal.id) || streamMap.has(terminal.id)) {
        return { ptyInstanceId: ptyMap.get(terminal.id) ?? streamMap.get(terminal.id)! }
      }

      const agentRow = getAgentByTerminalId(db, terminal.id)
      const agentType = agentRow?.agentType as AgentType | undefined
      let agentExtraEnv: Record<string, string> | undefined
      const includeWandaMcp = agentType != null && state.httpPort != null && resolveWandaMcpEnabledForPod(db, pod.id)
      // Base args may be augmented by resolved agent config (e.g. claude's --dangerously-skip-permissions).
      let effectiveArgs: string[] | null = terminal.args ?? null
      if (agentType) {
        const resolvedCfg = yield* agentConfigSvc.resolveForPod(pod.id, agentType)
        const configuredArgs = buildAgentConfigArgs(agentType, resolvedCfg)
        if (configuredArgs.length > 0) effectiveArgs = [...(effectiveArgs ?? []), ...configuredArgs]
        if (includeWandaMcp && state.httpPort) {
          effectiveArgs = [...buildAgentTerminalMcpArgs(agentType, state.httpPort), ...(effectiveArgs ?? [])]
        }
        const isDocker = getPodRuntime(pod)?.type === 'docker'
        agentExtraEnv = buildAgentTerminalEnv(state, {
          terminalId: terminal.id,
          agentType,
          isDocker,
          includeWandaMcp,
        })
        const existingCleanups = hookCleanups.get(pod.id) ?? []
        injectAgentHooks(agentStatusSvc, existingCleanups, {
          terminalId: terminal.id,
          agentType,
          cwd: pod.cwd,
          isDocker,
          claudeHookUrl: claudeHookUrl(state, isDocker),
        })
        hookCleanups.set(pod.id, existingCleanups)
      }

      const podRuntime = getPodRuntime(pod)

      // Workenv-attached shell terminals route through WorkenvExec. Agent
      // terminals stay on the host so they can use host auth and hooks,
      // matching the full-pod start path above.
      if (pod.workenvId && podRuntime?.type !== 'docker' && !agentType) {
        const readyResult = yield* Effect.either(workenv.ensureReadyForTerminal(pod.id, pod.workenvId))
        if (readyResult._tag === 'Left') {
          log.pod.error(`pod ${pod.id}: workenv not ready before terminal exec`, readyResult.left)
          return null
        }

        const cmd = terminal.command ?? pod.shell ?? '/bin/sh'
        const env = mergeEnv(pod.env, terminal.env, agentExtraEnv)
        const result = yield* Effect.either(
          workenv.startTerminal(pod.id, pod.workenvId, terminal.id, {
            cmd,
            args: effectiveArgs ?? undefined,
            env,
            cwd: pod.cwd,
            pty: true,
          }),
        )
        if (result._tag === 'Left') {
          log.pod.error(`workenv exec failed for terminal ${terminal.id}`, result.left)
          return null
        }
        return { ptyInstanceId: result.right }
      }

      if (state.targetManager) {
        const target = resolveTargetForPod(state.targetManager, pod)
        if (!target || target.status !== 'connected') return null

        if (podRuntime?.type === 'docker') {
          const containerId = containerMap.get(pod.id)
          if (!containerId) return null

          const mergedEnv = mergeEnv(
            { TERM: 'xterm-256color', USER: 'root', HOME: '/root' },
            podRuntime.env,
            pod.env,
            terminal.env,
            agentExtraEnv,
          )
          const shell = '/bin/sh'
          const execCmd = terminal.command ? [terminal.command, ...(effectiveArgs ?? [])] : [shell]

          const execResult = yield* Effect.either(
            Effect.tryPromise(() =>
              target.dockerExec({
                containerId,
                cmd: execCmd,
                env: mergedEnv,
                workDir: podRuntime.workDir,
              }),
            ),
          )
          if (Either.isLeft(execResult)) return null
          const streamId = execResult.right
          streamMap.set(terminal.id, streamId)
          state.targetManager!.registerStream(streamId, target.id)
          target.onStreamExit(streamId, (code) => handleTerminalExit(terminal.id, pod.id, code))
          return { ptyInstanceId: streamId }
        } else {
          // Target-routed PTY path
          const termEnv = mergeEnv(pod.env, terminal.env, agentExtraEnv)
          const ptyResult = yield* Effect.either(
            Effect.tryPromise(() =>
              target.ptyCreate({
                cwd: pod.cwd,
                command: terminal.command ?? pod.shell ?? undefined,
                args: effectiveArgs ?? undefined,
                env: termEnv,
              }),
            ),
          )
          if (Either.isLeft(ptyResult)) {
            log.pod.error(`target.ptyCreate failed for terminal ${terminal.id}`, ptyResult.left)
            return null
          }
          const streamId = ptyResult.right
          streamMap.set(terminal.id, streamId)
          state.targetManager!.registerStream(streamId, target.id)
          target.onStreamExit(streamId, (code) => handleTerminalExit(terminal.id, pod.id, code))
          return { ptyInstanceId: streamId }
        }
      } else {
        // Legacy direct PTY path
        const termEnv = mergeEnv(pod.env, terminal.env, agentExtraEnv)
        const ptyResult = yield* Effect.either(
          pty.create({
            cwd: pod.cwd,
            command: terminal.command ?? pod.shell ?? undefined,
            args: effectiveArgs ?? undefined,
            env: termEnv,
            onExit: (_id, exitCode) => handleTerminalExit(terminal.id, pod.id, exitCode),
          }),
        )
        if (Either.isLeft(ptyResult)) {
          log.pod.error(`pty.create failed for terminal ${terminal.id}`, ptyResult.left)
          return null
        }
        ptyMap.set(terminal.id, ptyResult.right)
        return { ptyInstanceId: ptyResult.right }
      }
    })
  }

  return {
    startPodTerminals,
    stopPodTerminals,
    startSingleTerminal,
    checkAllExited,
    startCommandEffect,
    stopCommandStream,
    destroyWorkenvStream: (streamId) => workenv.destroyStream(streamId),
  }
}
