import { join } from 'node:path'
import Database from 'better-sqlite3'
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
import { WorkenvTemplates, WorkenvTemplatesLive } from '../templates'
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

describe('WorkenvController.update', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, tracker } = setup())
  })

  it('updates name only and reports impact=live with no changedKeys', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'old', slug: 'a', config: minimalConfig }))
    tracker.clear()

    const { row, report } = await runtime.runPromise(ctl.update(w.id, { name: 'new' }))
    expect(row.name).toBe('new')
    expect(report.impact).toBe('live')
    expect(report.changedKeys).toEqual([])
    expect(tracker.sendsOn('workenv.updated')).toHaveLength(1)
  })

  it('updates config.env and reports impact=restart', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))

    const { row, report } = await runtime.runPromise(
      ctl.update(w.id, {
        config: { ...minimalConfig, env: { NODE_ENV: 'production' } },
      }),
    )
    expect(row.config.env).toEqual({ NODE_ENV: 'production' })
    expect(report.impact).toBe('restart')
    expect(report.restartKeys).toContain('env')
  })

  it('compiles new layers into ports on update and reports restart impact', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))

    const { row, report } = await runtime.runPromise(
      ctl.update(w.id, {
        config: {
          ...minimalConfig,
          layers: [
            { kind: 'pkg', id: 'pkg:c', manager: 'apt', packages: ['curl'] },
            {
              kind: 'service',
              id: 'service:redis',
              name: 'redis',
              image: 'redis:7',
              ports: [{ name: 'redis', guest: 6379, host: 'auto', protocol: 'tcp' }],
            },
          ],
        },
      }),
    )
    // Bootstrap is NOT persisted on update — it's compiled fresh at start.
    expect(row.config.bootstrap).toBeUndefined()
    expect(row.config.ports?.find((p) => p.name === 'redis')?.guest).toBe(6379)
    expect(report.impact).toBe('restart')
    expect(report.restartKeys).toContain('layers')
  })

  it('compiles template extends on update', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const templates = await runtime.runPromise(WorkenvTemplates)
    const template = await runtime.runPromise(
      templates.create({
        name: 'Template',
        runtime: 'orbstack',
        config: {
          runtime: 'orbstack',
          layers: [
            {
              kind: 'service',
              id: 'service:postgres',
              name: 'postgres',
              image: 'postgres:16',
              ports: [{ name: 'postgres', guest: 5432, host: 'auto', protocol: 'tcp' }],
            },
          ],
        },
      }),
    )
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))

    const { row, report } = await runtime.runPromise(
      ctl.update(w.id, {
        config: { ...minimalConfig, extends: [template.id] },
      }),
    )

    expect(row.config.layers?.map((l) => l.id)).toEqual(['service:postgres'])
    expect(row.config.ports?.[0]?.guest).toBe(5432)
    expect(report.impact).toBe('restart')
  })

  it('rejects invalid config', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))

    const result = await runtime
      .runPromise(
        ctl.update(w.id, {
          // @ts-expect-error — deliberately invalid: missing runtime
          config: { worktreePath: '/tmp/bad' },
        }),
      )
      .catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
  })

  it('rejects unknown id', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const result = await runtime.runPromise(ctl.update('nope', { name: 'x' })).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
  })

  it('updates configHash + worktreePath column on config change', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: minimalConfig }))

    const { row } = await runtime.runPromise(
      ctl.update(w.id, {
        config: { ...minimalConfig, worktreePath: '/tmp/new' },
      }),
    )
    expect(row.worktreePath).toBe('/tmp/new')
    expect(row.configHash).not.toBe(w.configHash)
  })
})
