import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../../db/migrate'
import * as schema from '../../../../db/schema'
import * as taskSchema from '../../../../db/task-schema'
import { DatabaseService } from '../../../../infra/database'
import { makeRuntimeRegistryLive } from '../../../../services/runtime-registry.service'
import { makeTestBroadcasterLayer } from '../../../../testing/broadcaster-tracker'
import { FakeRuntimeAdapter } from '../../../../testing/fake-runtime-adapter'
import { BootstrapRunnerLive } from '../bootstrap-runner'
import { WorkenvEventsLive } from '../events'
import { WorkenvHealthLive } from '../health'
import { WorkenvReconciler, WorkenvReconcilerLive } from '../reconciler'
import { WorkenvTemplatesLive } from '../templates'
import { WorkenvController, WorkenvControllerLive } from '../workenv'

function setup() {
  const adapter = new FakeRuntimeAdapter({ runtime: 'orbstack' })
  const dbLayer = Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../../../../db/migrations'))
    return db
  })
  const { layer: broadcasterLayer, tracker } = makeTestBroadcasterLayer()
  const registryLayer = makeRuntimeRegistryLive({ adapters: [adapter] })

  const events = WorkenvEventsLive.pipe(Layer.provideMerge(Layer.mergeAll(dbLayer, broadcasterLayer)))
  const health = WorkenvHealthLive.pipe(
    Layer.provideMerge(Layer.mergeAll(events, registryLayer, dbLayer, broadcasterLayer)),
  )
  const tpls = WorkenvTemplatesLive.pipe(Layer.provideMerge(dbLayer))
  const bootstrap = BootstrapRunnerLive.pipe(Layer.provideMerge(Layer.mergeAll(events, dbLayer, broadcasterLayer)))
  const controller = WorkenvControllerLive.pipe(
    Layer.provideMerge(Layer.mergeAll(events, health, tpls, bootstrap, registryLayer, dbLayer, broadcasterLayer)),
  )
  const reconciler = WorkenvReconcilerLive.pipe(
    Layer.provideMerge(Layer.mergeAll(events, registryLayer, dbLayer, broadcasterLayer)),
  )
  return {
    runtime: ManagedRuntime.make(Layer.mergeAll(controller, reconciler)),
    adapter,
    tracker,
  }
}

const minimalConfig = { runtime: 'orbstack' as const, worktreePath: '/tmp/demo' }

describe('WorkenvReconciler', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let adapter: FakeRuntimeAdapter
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, adapter, tracker } = setup())
  })

  it('flips a running workenv whose adapter handle is gone to stranded', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const reconciler = await runtime.runPromise(WorkenvReconciler)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))
    await runtime.runPromise(ctl.start(w.id))

    // Simulate the VM being deleted out-of-band: adapter.list() no longer
    // returns this handle.
    await runtime.runPromise(
      adapter.destroy({
        runtime: 'orbstack',
        adapterHandle: w.adapterHandle!,
        state: w.runtimeState!,
      }),
    )
    tracker.clear()

    await runtime.runPromise(reconciler.reconcile())

    const after = await runtime.runPromise(ctl.getById(w.id))
    expect(after?.state).toBe('stranded')
    expect(tracker.lastOn('workenv.state.changed')).toEqual([w.id, 'running', 'stranded'])
  })

  it('leaves a running workenv whose handle IS present unchanged', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const reconciler = await runtime.runPromise(WorkenvReconciler)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))
    await runtime.runPromise(ctl.start(w.id))
    tracker.clear()

    await runtime.runPromise(reconciler.reconcile())

    const after = await runtime.runPromise(ctl.getById(w.id))
    expect(after?.state).toBe('running')
    expect(tracker.sendsOn('workenv.state.changed')).toHaveLength(0)
  })

  it('flips a stopped workenv whose handle is gone to stranded', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const reconciler = await runtime.runPromise(WorkenvReconciler)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))
    // w is in 'stopped' state right after create.
    await runtime.runPromise(
      adapter.destroy({
        runtime: 'orbstack',
        adapterHandle: w.adapterHandle!,
        state: w.runtimeState!,
      }),
    )
    tracker.clear()

    await runtime.runPromise(reconciler.reconcile())

    const after = await runtime.runPromise(ctl.getById(w.id))
    expect(after?.state).toBe('stranded')
  })

  it('leaves rows in error state alone (user must ack before retry)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const reconciler = await runtime.runPromise(WorkenvReconciler)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))
    const db = await runtime.runPromise(DatabaseService)
    // Wipe the handle from the adapter's world and flip the row to error.
    await runtime.runPromise(
      adapter.destroy({
        runtime: 'orbstack',
        adapterHandle: w.adapterHandle!,
        state: w.runtimeState!,
      }),
    )
    db.update(schema.workenvs).set({ state: 'error' }).where(eq(schema.workenvs.id, w.id)).run()
    tracker.clear()

    await runtime.runPromise(reconciler.reconcile())

    const row = db.select().from(schema.workenvs).where(eq(schema.workenvs.id, w.id)).get()
    expect(row?.state).toBe('error')
  })

  it('reconcile is idempotent (running a second time does nothing)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const reconciler = await runtime.runPromise(WorkenvReconciler)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))
    await runtime.runPromise(
      adapter.destroy({
        runtime: 'orbstack',
        adapterHandle: w.adapterHandle!,
        state: w.runtimeState!,
      }),
    )

    await runtime.runPromise(reconciler.reconcile())
    tracker.clear()
    await runtime.runPromise(reconciler.reconcile())

    expect(tracker.sendsOn('workenv.state.changed')).toHaveLength(0)
  })
})
