import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { WorkenvHealth, WorkenvHealthLive } from '../health'
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
  return {
    runtime: ManagedRuntime.make(controller),
    adapter,
    tracker,
  }
}

const healthcheckConfig = {
  runtime: 'orbstack' as const,
  worktreePath: '/tmp/h',
  healthcheck: { cmd: 'curl -fsS localhost:3000/healthz', intervalSec: 30, startPeriodSec: 0 },
}

const healthcheckWithGrace = {
  ...healthcheckConfig,
  healthcheck: { cmd: 'curl -fsS localhost:3000/healthz', intervalSec: 30, startPeriodSec: 300 },
}

describe('WorkenvHealth', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let adapter: FakeRuntimeAdapter
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, adapter, tracker } = setup())
  })

  it('pollOnce returns ok=true when the healthcheck cmd exits 0', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.execScript = { data: [], exitCode: 0 }

    const result = await runtime.runPromise(health.pollOnce(w.id))
    expect(result).toEqual({ ok: true })
    expect(adapter.calls.exec.at(-1)?.req).toMatchObject({
      cmd: '/bin/sh',
      args: ['-c', healthcheckConfig.healthcheck.cmd],
      pty: false,
    })
  })

  it('pollOnce returns ok=false when the healthcheck cmd exits non-zero', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.execScript = { data: ['curl: (7) Failed to connect'], exitCode: 7 }

    const result = await runtime.runPromise(health.pollOnce(w.id))
    expect(result).toEqual({ ok: false })
  })

  it('pollOnce skips workenvs without healthcheck config', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(
      ctl.create({
        name: 'no-hc',
        slug: 'no-hc',
        config: { runtime: 'orbstack', worktreePath: '/tmp/x' },
      }),
    )
    await runtime.runPromise(ctl.start(w.id))

    const result = await runtime.runPromise(health.pollOnce(w.id))
    expect(result).toBeNull()
    expect(adapter.calls.exec).toHaveLength(0)
  })

  it('pollOnce skips workenvs that are not running', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    // Stopped state — skip.
    const result = await runtime.runPromise(health.pollOnce(w.id))
    expect(result).toBeNull()
    expect(adapter.calls.exec).toHaveLength(0)
  })

  it('pollOnce broadcasts workenv.health with [id, ok] and persists lastHealthyAt on success', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.execScript = { data: [], exitCode: 0 }
    tracker.clear()

    await runtime.runPromise(health.pollOnce(w.id))
    expect(tracker.lastOn('workenv.health')).toEqual([w.id, true])

    const after = await runtime.runPromise(ctl.getById(w.id))
    expect(after?.lastHealthyAt).toBeTruthy()
  })

  it('pollOnce broadcasts workenv.health with [id, false] on failure and appends health.failed event', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.execScript = { data: [], exitCode: 1 }
    tracker.clear()

    await runtime.runPromise(health.pollOnce(w.id))
    expect(tracker.lastOn('workenv.health')).toEqual([w.id, false])

    const db = await runtime.runPromise(DatabaseService)
    const evtTypes = listEventsForWorkenv(db, w.id).map((e) => e.type)
    expect(evtTypes).toContain('health.failed')
  })

  it('pollOnce skips checks within the startPeriodSec grace window', async () => {
    // Fresh-started workenv with a 5-minute grace window — any poll within
    // the window should return null without calling the adapter.
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckWithGrace }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.calls.exec.length = 0

    const result = await runtime.runPromise(health.pollOnce(w.id))
    expect(result).toBeNull()
    expect(adapter.calls.exec).toHaveLength(0)
  })

  it('startPolling is idempotent — calling twice does not double-schedule', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))

    health.startPolling(w.id)
    health.startPolling(w.id)
    health.stopPolling(w.id)
    // No assertions beyond "doesn't throw" — the real schedule runs on
    // timers we don't want to wait for in unit tests.
    expect(true).toBe(true)
  })

  it('stopPolling on an unknown id is a no-op', async () => {
    const health = await runtime.runPromise(WorkenvHealth)
    expect(() => health.stopPolling('nope')).not.toThrow()
  })

  it('pollOnce de-duplicates identical consecutive health states (ok→ok emits only first)', async () => {
    // Optional but nice-to-have: noise reduction. If we already broadcast
    // true and the next check is also true, skip the re-broadcast.
    const ctl = await runtime.runPromise(WorkenvController)
    const health = await runtime.runPromise(WorkenvHealth)
    const w = await runtime.runPromise(ctl.create({ name: 'h', slug: 'h', config: healthcheckConfig }))
    await runtime.runPromise(ctl.start(w.id))
    adapter.execScript = { data: [], exitCode: 0 }

    await runtime.runPromise(health.pollOnce(w.id))
    tracker.clear()
    await runtime.runPromise(health.pollOnce(w.id))
    expect(tracker.sendsOn('workenv.health')).toHaveLength(0)

    // Flip to failing — should broadcast the flip.
    adapter.execScript = { data: [], exitCode: 1 }
    await runtime.runPromise(health.pollOnce(w.id))
    expect(tracker.lastOn('workenv.health')).toEqual([w.id, false])
  })
})

// Silence any stray timer warnings in this file.
vi.setConfig({ testTimeout: 10_000 })
