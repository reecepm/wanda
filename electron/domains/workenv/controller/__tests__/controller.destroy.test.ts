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
import { listEventsForWorkenv } from '../../repository'
import { BootstrapRunnerLive } from '../bootstrap-runner'
import { WorkenvEventsLive } from '../events'
import { WorkenvHealthLive } from '../health'
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
  const layer = WorkenvControllerLive.pipe(
    Layer.provideMerge(Layer.mergeAll(events, health, tpls, bootstrap, registryLayer, dbLayer, broadcasterLayer)),
  )
  return { runtime: ManagedRuntime.make(layer), adapter, tracker }
}

const minimalConfig = { runtime: 'orbstack' as const, worktreePath: '/tmp/demo' }

describe('WorkenvController.destroy', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let adapter: FakeRuntimeAdapter
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, adapter, tracker } = setup())
  })

  it('hard-deletes the row from the DB', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    await runtime.runPromise(ctl.destroy(w.id))

    expect(await runtime.runPromise(ctl.getById(w.id))).toBeUndefined()
    expect(await runtime.runPromise(ctl.list())).toEqual([])
  })

  it('calls adapter.destroy with the correct handle', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    await runtime.runPromise(ctl.destroy(w.id))

    expect(adapter.calls.destroy).toHaveLength(1)
    expect(adapter.calls.destroy[0]!.adapterHandle).toBe(w.adapterHandle)
  })

  it('cascades to workenv_events (rows gone)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    const db = await runtime.runPromise(DatabaseService)
    expect(listEventsForWorkenv(db, w.id).length).toBeGreaterThan(0)

    await runtime.runPromise(ctl.destroy(w.id))
    expect(listEventsForWorkenv(db, w.id)).toEqual([])
  })

  it('detaches attached pods (workenv_id → null)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    const db = await runtime.runPromise(DatabaseService)

    // Insert a pod referencing the workenv.
    db.insert(schema.workspaces).values({ id: 'ws1', name: 'ws', cwd: '/tmp', sortOrder: 0 }).run()
    db.insert(schema.pods)
      .values({
        id: 'p1',
        workspaceId: 'ws1',
        name: 'pod',
        cwd: '/tmp',
        workenvId: w.id,
        containerLifecycle: 'inherit',
      })
      .run()

    await runtime.runPromise(ctl.destroy(w.id))

    const pod = db.select().from(schema.pods).where(eq(schema.pods.id, 'p1')).get()!
    expect(pod.workenvId).toBeNull()
  })

  it('broadcasts workenv.destroyed', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    tracker.clear()

    await runtime.runPromise(ctl.destroy(w.id))
    expect(tracker.lastOn('workenv.destroyed')).toEqual([w.id])
  })

  it('still removes the row when adapter.destroy throws (best-effort)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    adapter.failNext = { method: 'destroy', error: new Error('vm gone') }

    await runtime.runPromise(ctl.destroy(w.id))
    expect(await runtime.runPromise(ctl.getById(w.id))).toBeUndefined()
  })

  it('destroy on an unknown id is a no-op (does not throw)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    await expect(runtime.runPromise(ctl.destroy('nope'))).resolves.toBeUndefined()
    expect(adapter.calls.destroy).toHaveLength(0)
  })

  it('destroy on a workenv with no adapter handle (creating-state failure) skips adapter.destroy', async () => {
    // Force a create failure so the row is in 'error' state with no
    // adapter handle.
    adapter.failNext = { method: 'create', error: new Error('boom') }
    const ctl = await runtime.runPromise(WorkenvController)
    await runtime
      .runPromise(ctl.create({ name: 'orphan', slug: 'orphan', config: minimalConfig }))
      .catch(() => undefined)

    const all = await runtime.runPromise(ctl.list())
    expect(all).toHaveLength(1)
    const orphan = all[0]!
    expect(orphan.adapterHandle).toBeNull()

    await runtime.runPromise(ctl.destroy(orphan.id))
    expect(adapter.calls.destroy).toHaveLength(0)
    expect(await runtime.runPromise(ctl.list())).toEqual([])
  })
})
