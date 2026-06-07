import { eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { LABEL_PREFIX } from '../app-config'
import { pods } from '../db/schema'
import { log } from '../packages/logger'
import { DockerService } from '../services/docker.service'
import { DatabaseService } from './database'

const GC_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface GcServiceShape {
  readonly start: () => void
  readonly stop: () => void
  readonly runOnce: Effect.Effect<void>
}

export class GcService extends Context.Tag('GcService')<GcService, GcServiceShape>() {}

export const GcServiceLive = Layer.effect(
  GcService,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const dockerService = yield* DockerService

    let timer: ReturnType<typeof setInterval> | null = null

    /** Stop + remove sidecar containers whose pod is no longer running */
    const cleanOrphanedSidecars = Effect.gen(function* () {
      const containers = yield* dockerService.listContainers(true)

      const sidecars = containers.filter((c) => c.labels?.[`${LABEL_PREFIX}.sidecar`] === 'true')
      if (sidecars.length === 0) return

      const runningPods = new Set(
        db
          .select({ id: pods.id })
          .from(pods)
          .where(eq(pods.status, 'running'))
          .all()
          .map((p) => p.id),
      )

      let cleaned = 0
      for (const sidecar of sidecars) {
        const podId = sidecar.labels?.[`${LABEL_PREFIX}.pod`]
        if (podId && runningPods.has(podId)) continue

        const result = yield* Effect.either(
          Effect.gen(function* () {
            if (sidecar.state === 'running') {
              yield* dockerService.stopContainer(sidecar.id, 2)
            }
            yield* dockerService.removeContainer(sidecar.id, true)
          }),
        )
        if (result._tag === 'Right') {
          cleaned++
        } else {
          log.gc.debug(`Sidecar cleanup skipped for ${sidecar.id}:`, result.left)
        }
      }
      if (cleaned > 0) log.gc.info(`Cleaned ${cleaned} orphaned sidecar containers`)
    })

    const runAll = Effect.gen(function* () {
      log.gc.info('Starting garbage collection')
      yield* cleanOrphanedSidecars.pipe(
        Effect.catchAll((err) => Effect.sync(() => log.gc.error('Sidecar cleanup failed:', err))),
      )
      log.gc.info('Garbage collection complete')
    })

    return {
      start: () => {
        // Run after a short delay to not block startup
        setTimeout(() => void Effect.runPromise(runAll).catch((err) => log.gc.error('GC cycle failed:', err)), 5000)
        timer = setInterval(
          () => void Effect.runPromise(runAll).catch((err) => log.gc.error('GC cycle failed:', err)),
          GC_INTERVAL_MS,
        )
      },
      stop: () => {
        if (timer) clearInterval(timer)
        timer = null
      },
      runOnce: runAll,
    }
  }),
)
