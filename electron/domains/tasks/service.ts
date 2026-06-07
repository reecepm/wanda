import { createTaskStore, type TaskStore } from '@wanda/tasks'
import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../infra/database'
import { log } from '../../packages/logger'
import { SettingsController } from '../settings/controller'
import { createDrizzleStorageAdapter } from './drizzle-adapter'

export class TaskStoreService extends Context.Tag('TaskStoreService')<TaskStoreService, TaskStore>() {}

const TICK_INTERVAL_MS = 10_000

export const TaskStoreServiceLive = Layer.scoped(
  TaskStoreService,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const settings = yield* SettingsController

    const instanceName = yield* settings.get('tasks.instanceName').pipe(Effect.map((v) => v ?? 'wanda'))

    const storage = createDrizzleStorageAdapter(db)
    const store = yield* Effect.promise(() => createTaskStore({ storage, instanceName }))

    // Start the tick interval (lease expiry + dependency reconciliation).
    // A tick failure is logged but not fatal — the next interval retries.
    // The timer is unref'd so it can't keep the process alive, and a scope
    // finalizer clears it (and closes the store) on runtime dispose so the
    // interval never outlives the layer.
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const timer = setInterval(() => {
          store.tick().catch((err) => log.main.warn('tasks: tick failed:', err))
        }, TICK_INTERVAL_MS)
        timer.unref?.()
        return timer
      }),
      (timer) =>
        Effect.promise(async () => {
          clearInterval(timer)
          await store.close()
        }),
    )

    return store
  }),
)
