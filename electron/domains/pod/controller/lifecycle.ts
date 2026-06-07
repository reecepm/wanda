import { Context, Effect, Layer } from 'effect'
import { Broadcaster } from '../../../infra/broadcaster'
import { DatabaseService } from '../../../infra/database'
import { type PodStatus, resetStaleLocalPodStatuses, setPodStatus as updatePodStatus } from '../repository'
import type { PodRuntime } from '../types'
import { isLocalPty } from './container'

interface PodLifecycleControllerShape {
  readonly setPodStatus: (podId: string, status: PodStatus) => void

  /** Reset stale running/transitional non-Docker pods to stopped on startup. */
  readonly resetStalePods: () => void

  /** Check if a pod is a simple local PTY (no Docker runtime). */
  readonly isLocalPty: (pod: { runtime: PodRuntime | null | undefined }) => boolean
}

export class PodLifecycleController extends Context.Tag('PodLifecycleController')<
  PodLifecycleController,
  PodLifecycleControllerShape
>() {}

export const PodLifecycleControllerLive = Layer.effect(
  PodLifecycleController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const emitter = yield* Broadcaster

    function setPodStatus(podId: string, status: PodStatus) {
      updatePodStatus(db, podId, status)
      emitter.send('pod:status', podId, status)
    }

    return {
      setPodStatus,

      resetStalePods: () => {
        resetStaleLocalPodStatuses(db)
      },

      isLocalPty,
    }
  }),
)
