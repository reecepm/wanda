import { Effect, Fiber, Runtime } from 'effect'
import type { TargetManager } from '../../../../targets/target-manager'

/**
 * Shared mutable state for the pod controller, threaded through the extracted
 * terminal / workenv / agent-env modules. Created once per `PodControllerLive`
 * instance.
 *
 * The locking primitives here are the Phase-2 per-pod race guard: every
 * lifecycle mutation runs under its pod's semaphore so create-and-register of a
 * stream is atomic with respect to teardown, and forked restart-on-exit fibers
 * are tracked so stop/delete/shutdown can interrupt them before they spawn a
 * process against a torn-down pod.
 */
export interface PodRuntimeState {
  /** Map<podTerminalId, ptyInstanceId> for legacy direct-PTY tracking. */
  readonly ptyMap: Map<string, string>
  /** Map<podTerminalId, streamId> for target-routed streams (PTY or Docker exec). */
  readonly streamMap: Map<string, string>
  /** Map<podId, containerId> for Docker runtime containers. */
  readonly containerMap: Map<string, string>
  /** Map<podCommandId, streamId> for command streams. */
  readonly commandStreamMap: Map<string, string>
  /** Map<podCommandId, ptyInstanceId> for legacy command PTY instances. */
  readonly commandPtyMap: Map<string, string>
  /** Pods currently in a start/stop transition, to dedup idempotent callers. */
  readonly transitioning: Set<string>
  /** Map<podId, tunnelId[]> for active port-forward tunnels (remote targets only). */
  readonly portForwardTunnels: Map<string, string[]>
  /** Per-pod hook cleanup functions (for agent status hooks). */
  readonly hookCleanups: Map<string, (() => void)[]>

  /** Run `effect` while holding `podId`'s lifecycle lock, serializing it against
   * every other lock-guarded mutation for the same pod. */
  readonly withPodLock: <A, E, R>(podId: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Drop a pod's lock once it is deleted. */
  readonly deletePodLock: (podId: string) => void

  /** Track a forked restart-on-exit fiber so teardown can interrupt it. */
  readonly trackRestart: (podId: string, fiber: Fiber.RuntimeFiber<void, never>) => void
  /** Stop tracking a restart fiber that finished on its own. */
  readonly untrackRestart: (podId: string, fiber: Fiber.RuntimeFiber<void, never>) => void
  /** Interrupt all pending restart fibers for a pod. */
  readonly cancelPendingRestarts: (podId: string) => void
  /** Interrupt every pending restart fiber across all pods. */
  readonly cancelAllPendingRestarts: () => void

  /** Injected lazily by the shell once the relevant subsystems are ready. */
  targetManager: TargetManager | null
  httpPort: number | null
  hookToken: string | null
}

export function makePodRuntimeState(runtime: Runtime.Runtime<never>): PodRuntimeState {
  const ptyMap = new Map<string, string>()
  const streamMap = new Map<string, string>()
  const containerMap = new Map<string, string>()
  const commandStreamMap = new Map<string, string>()
  const commandPtyMap = new Map<string, string>()
  const transitioning = new Set<string>()
  // One serialization lock per pod. Every lifecycle mutation (start, stop,
  // restart, delete, removeTerminal, and the restart-on-exit timer) runs under
  // its pod's lock so they cannot interleave — e.g. ensureStarted can no longer
  // spawn a PTY against a row that delete is concurrently removing. The
  // `transitioning` set still dedups idempotent callers; the lock guarantees
  // the create-and-register of a stream is atomic with respect to teardown.
  const podLocks = new Map<string, Effect.Semaphore>()
  const portForwardTunnels = new Map<string, string[]>()
  // Track forked restart-on-exit fibers per pod so stop/delete/shutdown can
  // interrupt them before they spawn a process against a torn-down pod.
  const pendingRestarts = new Map<string, Set<Fiber.RuntimeFiber<void, never>>>()
  const hookCleanups = new Map<string, (() => void)[]>()

  function trackRestart(podId: string, fiber: Fiber.RuntimeFiber<void, never>) {
    let set = pendingRestarts.get(podId)
    if (!set) {
      set = new Set()
      pendingRestarts.set(podId, set)
    }
    set.add(fiber)
  }

  function untrackRestart(podId: string, fiber: Fiber.RuntimeFiber<void, never>) {
    pendingRestarts.get(podId)?.delete(fiber)
  }

  function cancelPendingRestarts(podId: string) {
    const fibers = pendingRestarts.get(podId)
    if (fibers) {
      for (const fiber of fibers) Runtime.runFork(runtime)(Fiber.interrupt(fiber))
      fibers.clear()
      pendingRestarts.delete(podId)
    }
  }

  function cancelAllPendingRestarts() {
    for (const [podId] of pendingRestarts) cancelPendingRestarts(podId)
  }

  function withPodLock<A, E, R>(podId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.gen(function* () {
      let sem = podLocks.get(podId)
      if (!sem) {
        sem = yield* Effect.makeSemaphore(1)
        podLocks.set(podId, sem)
      }
      return yield* sem.withPermits(1)(effect)
    })
  }

  return {
    ptyMap,
    streamMap,
    containerMap,
    commandStreamMap,
    commandPtyMap,
    transitioning,
    portForwardTunnels,
    hookCleanups,
    withPodLock,
    deletePodLock: (podId) => {
      podLocks.delete(podId)
    },
    trackRestart,
    untrackRestart,
    cancelPendingRestarts,
    cancelAllPendingRestarts,
    targetManager: null,
    httpPort: null,
    hookToken: null,
  }
}
