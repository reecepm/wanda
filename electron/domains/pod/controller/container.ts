import { Context, Effect, Layer } from 'effect'
import { LABEL_PREFIX } from '../../../app-config'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { log } from '../../../packages/logger'
import { removePodFromSshConfig } from '../../../packages/ssh'
import type { Target } from '../../../targets/target'
import type { TargetManager } from '../../../targets/target-manager'
import { GitController, type ShellExecFn } from '../../git/controller'
import { clearPodContainerState, clearPodResolvedPorts, getPodById, setPodGitContext } from '../repository'
import type { PodGitContext, PodRuntime } from '../types'

/** Safely extract a typed PodRuntime from a pod row's JSON column. */
export function getPodRuntime(pod: { runtime: PodRuntime | null | undefined }): PodRuntime {
  const rt = pod.runtime
  if (rt == null) return null
  if (rt.type === 'docker' || rt.type === 'pty') return rt
  return null
}

/** Returns true if the pod is a simple local PTY (no Docker runtime). */
export function isLocalPty(pod: { runtime: PodRuntime | null | undefined }): boolean {
  return getPodRuntime(pod)?.type !== 'docker'
}

/** Resolve the target for a given pod. Always returns the local target. */
export function resolveTargetForPod(targetManager: TargetManager | null, pod: unknown | null): Target | null {
  if (!targetManager || !pod) return null
  try {
    return targetManager.getLocalTarget()
  } catch (err) {
    log.pod.warn('resolveTargetForPod: getLocalTarget failed', err)
    return null
  }
}

function resolveLifecycle(podLifecycle: string | null, globalDefault: string | null): 'keep-running' | 'stop-on-exit' {
  const effective = !podLifecycle || podLifecycle === 'inherit' ? (globalDefault ?? 'keep-running') : podLifecycle
  return effective === 'stop-on-exit' ? 'stop-on-exit' : 'keep-running'
}

interface PodContainerControllerShape {
  /** Destroy (stop + remove) a pod's Docker container. */
  readonly destroyContainer: (opts: {
    podId: string
    containerMap: Map<string, string>
    portForwardTunnels: Map<string, string[]>
    targetManager: TargetManager | null
  }) => Effect.Effect<void>

  /** Stop a Docker container (but keep for reuse). */
  readonly stopContainer: (opts: {
    podId: string
    containerId: string
    target: Target | null
    portForwardTunnels: Map<string, string[]>
  }) => Effect.Effect<void>

  /** Background git context discovery. */
  readonly discoverGitContext: (opts: {
    podId: string
    containerMap: Map<string, string>
    targetManager: TargetManager | null
  }) => void

  /** Close port-forward tunnels for a pod. */
  readonly closePortForwards: (podId: string, target: Target | null, portForwardTunnels: Map<string, string[]>) => void

  /** Resolve lifecycle policy for shutdown. */
  readonly resolveLifecycle: (
    podLifecycle: string | null,
    globalDefault: string | null,
  ) => 'keep-running' | 'stop-on-exit'
}

export class PodContainerController extends Context.Tag('PodContainerController')<
  PodContainerController,
  PodContainerControllerShape
>() {}

export const PodContainerControllerLive = Layer.effect(
  PodContainerController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const gitSvc = yield* GitController
    const emitter = yield* Broadcaster

    return {
      resolveLifecycle,

      destroyContainer: (opts) =>
        Effect.gen(function* () {
          const { podId, containerMap, portForwardTunnels, targetManager: tm } = opts
          const containerId = containerMap.get(podId)
          if (!containerId) return

          const pod = getPodById(db, podId)
          const target = resolveTargetForPod(tm, pod ?? null)

          if (target) {
            yield* Effect.promise(async () => {
              // Best-effort destroy: a container that's already stopped /
              // removed is the expected terminal state for this path, so
              // errors are logged at debug for diagnostics and ignored.
              try {
                await target.dockerStopContainer(containerId, 5)
              } catch (err) {
                log.pod.debug('destroyContainer: stop failed (already stopped?)', { containerId, err })
              }
              try {
                await target.dockerRemoveContainer(containerId)
              } catch (err) {
                log.pod.debug('destroyContainer: remove failed (already removed?)', { containerId, err })
              }
              try {
                const containers = await target.dockerListContainers()
                for (const c of containers) {
                  if (c.labels?.[`${LABEL_PREFIX}.sidecar`] === 'true' && c.labels?.[`${LABEL_PREFIX}.pod`] === podId) {
                    try {
                      await target.dockerStopContainer(c.id, 2)
                    } catch (err) {
                      log.pod.debug('destroyContainer: sidecar stop failed', { sidecarId: c.id, err })
                    }
                    try {
                      await target.dockerRemoveContainer(c.id)
                    } catch (err) {
                      log.pod.debug('destroyContainer: sidecar remove failed', { sidecarId: c.id, err })
                    }
                  }
                }
              } catch (err) {
                log.pod.debug('destroyContainer: sidecar list failed', { podId, err })
              }
            })
          }
          containerMap.delete(podId)

          portForwardTunnels.delete(podId)

          removePodFromSshConfig(podId)
          clearPodContainerState(db, podId)
        }),

      stopContainer: (opts) =>
        Effect.gen(function* () {
          const { podId, containerId, target, portForwardTunnels } = opts
          if (target) {
            yield* Effect.promise(async () => {
              try {
                await target.dockerStopContainer(containerId, 5)
              } catch (err) {
                // Already stopped / container removed — expected terminal
                // state. Log at debug so investigators can still trace.
                log.pod.debug('stopContainer failed (already stopped?)', { containerId, err })
              }
            })
          }

          portForwardTunnels.delete(podId)

          removePodFromSshConfig(podId)
          clearPodResolvedPorts(db, podId)
        }),

      discoverGitContext: (opts) => {
        const { podId, containerMap, targetManager: tm } = opts
        setTimeout(async () => {
          try {
            const pod = getPodById(db, podId)
            if (!pod || pod.status !== 'running') return
            const existing = pod.gitContext
            if (existing?.source === 'user') return

            let shellExec: ShellExecFn
            if (tm) {
              const target = resolveTargetForPod(tm, pod)
              if (!target || target.status !== 'connected') return

              const containerId = containerMap.get(podId)
              if (getPodRuntime(pod)?.type === 'docker') {
                if (!containerId) return
                shellExec = async (shellOpts) => {
                  const result = await target.shellExec({
                    command: `docker exec ${containerId} sh -c ${JSON.stringify(shellOpts.command)}`,
                    cwd: shellOpts.cwd,
                    env: shellOpts.env,
                  })
                  return result
                }
              } else {
                shellExec = (shellOpts) => target.shellExec(shellOpts)
              }
            } else {
              const { spawnSync } = await import('node:child_process')
              shellExec = async (shellOpts) => {
                const result = spawnSync(shellOpts.command, {
                  shell: true,
                  cwd: shellOpts.cwd,
                  env: shellOpts.env ? { ...process.env, ...shellOpts.env } : process.env,
                  encoding: 'utf-8',
                  timeout: 10_000,
                })
                return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', exitCode: result.status ?? 1 }
              }
            }

            const info = await Effect.runPromise(gitSvc.discover(pod.cwd, shellExec))
            if (!info) return

            // Preserve any fields the caller already populated (baseRef,
            // worktreePath, worktreeBranch). Discovery only knows repoPath.
            const gitContext: PodGitContext = {
              ...(existing ?? {}),
              repoPath: info.repoPath,
              source: 'auto',
            }

            setPodGitContext(db, podId, gitContext)
            emitter.send('pod:gitContextChanged', podId)
            emitter.send('orpc:invalidate', 'pod', 'getById')
          } catch (err) {
            log.pod.error(`git discovery failed for pod ${podId}:`, err)
          }
        }, 2000)
      },

      closePortForwards: (podId, _target, portForwardTunnels) => {
        portForwardTunnels.delete(podId)
      },
    }
  }),
)
