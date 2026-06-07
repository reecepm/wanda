import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../../../../db/migrate'
import * as schema from '../../../../db/schema'
import * as taskSchema from '../../../../db/task-schema'
import { DatabaseService } from '../../../../infra/database'
import { makeTestBroadcasterLayer } from '../../../../testing/broadcaster-tracker'
import { createWorkenv } from '../../repository'
import { WorkenvEvents, WorkenvEventsLive } from '../events'

function makeRuntime() {
  const dbLayer = Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../../../../db/migrations'))
    return db
  })
  const { layer: broadcasterLayer, tracker } = makeTestBroadcasterLayer()
  const layer = WorkenvEventsLive.pipe(Layer.provideMerge(Layer.mergeAll(dbLayer, broadcasterLayer)))
  return { runtime: ManagedRuntime.make(layer), tracker }
}

async function withWorkenv(runtime: ReturnType<typeof makeRuntime>['runtime'], slug = 'demo'): Promise<string> {
  const db = await runtime.runPromise(DatabaseService)
  const w = createWorkenv(db, {
    name: slug,
    slug,
    worktreePath: `/tmp/${slug}`,
    runtime: 'orbstack',
    configHash: 'h',
    config: { runtime: 'orbstack', worktreePath: `/tmp/${slug}` },
  })
  return w.id
}

describe('WorkenvEvents service', () => {
  let runtime: ReturnType<typeof makeRuntime>['runtime']
  let tracker: ReturnType<typeof makeRuntime>['tracker']

  beforeEach(() => {
    ;({ runtime, tracker } = makeRuntime())
  })

  it('append() persists a row in workenv_events', async () => {
    const workenvId = await withWorkenv(runtime)
    const evts = await runtime.runPromise(WorkenvEvents)

    const e = await runtime.runPromise(evts.append({ workenvId, type: 'created', payload: { source: 'test' } }))

    expect(e.id).toMatch(/.+/)
    expect(e.type).toBe('created')
    expect(e.payload).toEqual({ source: 'test' })
    expect(e.workenvId).toBe(workenvId)

    const all = await runtime.runPromise(evts.listForWorkenv(workenvId))
    expect(all).toHaveLength(1)
    expect(all[0]!.id).toBe(e.id)
  })

  it('append() broadcasts workenv.event.added with [workenvId, type]', async () => {
    const workenvId = await withWorkenv(runtime)
    const evts = await runtime.runPromise(WorkenvEvents)

    await runtime.runPromise(evts.append({ workenvId, type: 'state.changed' }))

    expect(tracker.lastOn('workenv.event.added')).toEqual([workenvId, 'state.changed'])
  })

  it('append() does not broadcast on read paths', async () => {
    const workenvId = await withWorkenv(runtime)
    const evts = await runtime.runPromise(WorkenvEvents)

    await runtime.runPromise(evts.append({ workenvId, type: 'created' }))
    tracker.clear()

    await runtime.runPromise(evts.listForWorkenv(workenvId))
    expect(tracker.sendsOn('workenv.event.added')).toEqual([])
  })

  it('listForWorkenv returns newest-first and supports limit', async () => {
    const workenvId = await withWorkenv(runtime)
    const evts = await runtime.runPromise(WorkenvEvents)

    const types = ['created', 'state.changed', 'health.ok'] as const
    for (const t of types) {
      await runtime.runPromise(evts.append({ workenvId, type: t }))
      await new Promise((r) => setTimeout(r, 2))
    }

    const all = await runtime.runPromise(evts.listForWorkenv(workenvId))
    expect(all.map((r) => r.type)).toEqual(['health.ok', 'state.changed', 'created'])

    const limited = await runtime.runPromise(evts.listForWorkenv(workenvId, { limit: 1 }))
    expect(limited).toHaveLength(1)
    expect(limited[0]!.type).toBe('health.ok')
  })

  it('listForWorkenv only returns events for the requested workenv', async () => {
    const a = await withWorkenv(runtime, 'a')
    const b = await withWorkenv(runtime, 'b')
    const evts = await runtime.runPromise(WorkenvEvents)

    await runtime.runPromise(evts.append({ workenvId: a, type: 'created' }))
    await runtime.runPromise(evts.append({ workenvId: b, type: 'created' }))
    await runtime.runPromise(evts.append({ workenvId: a, type: 'state.changed' }))

    expect(await runtime.runPromise(evts.listForWorkenv(a))).toHaveLength(2)
    expect(await runtime.runPromise(evts.listForWorkenv(b))).toHaveLength(1)
  })

  it('appends multiple distinct event types in order', async () => {
    const workenvId = await withWorkenv(runtime)
    const evts = await runtime.runPromise(WorkenvEvents)

    const types = [
      'bootstrap.started',
      'bootstrap.step.started',
      'bootstrap.step.completed',
      'bootstrap.completed',
    ] as const
    for (const t of types) {
      await runtime.runPromise(evts.append({ workenvId, type: t }))
    }

    expect(tracker.sendsOn('workenv.event.added').map((args) => args[1])).toEqual(types)
  })
})
