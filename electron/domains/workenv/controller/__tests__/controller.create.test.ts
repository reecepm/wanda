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

describe('WorkenvController.create', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let adapter: FakeRuntimeAdapter
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, adapter, tracker } = setup())
  })

  it('inserts a row and lands in state=stopped after adapter.create succeeds', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))

    expect(w.id).toMatch(/.+/)
    expect(w.slug).toBe('demo')
    expect(w.runtime).toBe('orbstack')
    expect(w.state).toBe('stopped')
    expect(w.adapterHandle).not.toBeNull()
    expect(w.runtimeState).toEqual({
      runtime: 'orbstack',
      vmName: w.adapterHandle,
      arch: 'arm64',
    })
  })

  it('calls adapter.create with the slug and config', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    expect(adapter.calls.create).toHaveLength(1)
    expect(adapter.calls.create[0]!.slug).toBe('demo')
    expect(adapter.calls.create[0]!.config).toEqual(minimalConfig)
  })

  it('persists adapterHandle returned by adapter.create', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    const known = await runtime.runPromise(adapter.list())
    expect(known.map((h) => h.adapterHandle)).toContain(w.adapterHandle)
  })

  it('appends created and state.changed events', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    const db = await runtime.runPromise(DatabaseService)
    const types = listEventsForWorkenv(db, w.id)
      .map((e) => e.type)
      .sort()
    expect(types).toContain('created')
    expect(types).toContain('state.changed')
  })

  it('broadcasts workenv.created and workenv.state.changed', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    expect(tracker.lastOn('workenv.created')).toEqual([w.id])
    expect(tracker.lastOn('workenv.state.changed')).toEqual([w.id, 'creating', 'stopped'])
  })

  it('rejects duplicate slug', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    await runtime.runPromise(ctl.create({ name: 'a', slug: 'taken', config: minimalConfig }))

    const result = await runtime
      .runPromise(ctl.create({ name: 'b', slug: 'taken', config: minimalConfig }))
      .catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/slug/i)
  })

  it('on adapter.create failure, leaves the row in state=error with lastError set', async () => {
    adapter.failNext = { method: 'create', error: new Error('orbstack not installed') }
    const ctl = await runtime.runPromise(WorkenvController)

    await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig })).catch(() => undefined)

    const all = await runtime.runPromise(ctl.list())
    expect(all).toHaveLength(1)
    expect(all[0]!.state).toBe('error')
    expect(all[0]!.lastError).toMatch(/orbstack not installed/)
    expect(all[0]!.adapterHandle).toBeNull()
  })

  it('rejects an invalid config (missing required field) before touching the adapter', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const result = await runtime
      .runPromise(
        ctl.create({
          name: 'bad',
          slug: 'bad',
          // @ts-expect-error — intentionally invalid input
          config: { runtime: 'orbstack' /* missing worktreePath */ },
        }),
      )
      .catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
    expect(adapter.calls.create).toHaveLength(0)
  })

  it('list() returns all created workenvs', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    expect(await runtime.runPromise(ctl.list())).toEqual([])
    await runtime.runPromise(ctl.create({ name: 'a', slug: 'a', config: { runtime: 'orbstack', worktreePath: '/a' } }))
    await runtime.runPromise(ctl.create({ name: 'b', slug: 'b', config: { runtime: 'orbstack', worktreePath: '/b' } }))
    expect((await runtime.runPromise(ctl.list())).map((r) => r.slug).sort()).toEqual(['a', 'b'])
  })

  it('getById returns the row or undefined', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
    expect((await runtime.runPromise(ctl.getById(w.id)))?.id).toBe(w.id)
    expect(await runtime.runPromise(ctl.getById('missing'))).toBeUndefined()
  })

  it('compiles layers into base+ports on create (bootstrap is fresh-compiled at start)', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const w = await runtime.runPromise(
      ctl.create({
        name: 'demo',
        slug: 'demo-layered',
        config: {
          runtime: 'orbstack',
          worktreePath: '/tmp/demo',
          layers: [
            { kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04', arch: 'arm64' },
            { kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl', 'git'] },
            {
              kind: 'service',
              id: 'service:postgres-16',
              name: 'pg',
              image: 'postgres:16',
              ports: [{ name: 'postgres', guest: 5432, host: 'auto', protocol: 'tcp' }],
            },
          ],
        },
      }),
    )
    // Layer-derived flat fields persisted on create.
    expect(w.config.base).toEqual({ image: 'ubuntu:24.04', arch: 'arm64' })
    expect(w.config.ports?.find((p) => p.name === 'postgres')?.guest).toBe(5432)
    // Bootstrap is NOT persisted at create — it's compiled fresh at start
    // so catalog improvements flow into existing workenvs.
    expect(w.config.bootstrap).toBeUndefined()
    // Original `layers` array is preserved for round-trip authoring.
    expect(w.config.layers?.length).toBe(3)
  })

  it('manual template prebuild is reused when creating a workenv from the same logical layers', async () => {
    const ctl = await runtime.runPromise(WorkenvController)
    const db = await runtime.runPromise(DatabaseService)
    db.insert(schema.workenvTemplates)
      .values({
        id: 'tpl-project',
        name: 'Project Template',
        runtime: 'orbstack',
        config: {
          layers: [
            {
              kind: 'base',
              id: 'base:ubuntu-24',
              image: 'ubuntu:24.04',
              arch: 'arm64',
              install: [{ run: 'echo base', idempotencyKey: 'base' }],
            },
            {
              kind: 'tool',
              id: 'tool:node',
              name: 'Node ${param.version}',
              params: { version: '24' },
              install: [{ run: 'echo node-${param.version}', idempotencyKey: 'node' }],
            },
          ],
          prebuild: [{ kind: 'shell', label: 'Prepare project cache', run: 'echo prepare-template' }],
        },
        builtIn: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()

    const prebuild = await runtime.runPromise(ctl.prebuildTemplate('tpl-project'))
    expect(adapter.calls.create.map((c) => c.slug)).toEqual([`template-${prebuild.hash.slice(0, 12)}`])

    const w = await runtime.runPromise(
      ctl.create({
        name: 'from-template',
        slug: 'from-template',
        templateId: 'tpl-project',
        config: {
          runtime: 'orbstack',
          worktreePath: '/tmp/from-template',
          layers: [
            {
              install: [{ idempotencyKey: 'base', run: 'echo base' }],
              arch: 'arm64',
              image: 'ubuntu:24.04',
              id: 'base:ubuntu-24',
              kind: 'base',
            },
            {
              install: [{ idempotencyKey: 'node', run: 'echo node-${param.version}' }],
              params: { version: '24' },
              name: 'Node ${param.version}',
              id: 'tool:node',
              kind: 'tool',
            },
          ],
          prebuild: [{ kind: 'shell', label: 'Prepare project cache', run: 'echo prepare-template' }],
        },
      }),
    )

    expect(adapter.calls.create).toHaveLength(1)
    expect(adapter.calls.exec.map((c) => c.req.args?.join(' '))).toEqual([
      '-c echo base',
      '-c echo node-24',
      '-c echo prepare-template',
    ])
    expect(adapter.calls.exec[2]!.req.env).toMatchObject({
      WANDA_PREBUILD: '1',
      WANDA_WORKTREE_PATH: expect.stringMatching(/\.wanda\/prebuilds\/tpl-project$/),
    })
    expect(adapter.calls.clone).toHaveLength(1)
    expect(adapter.calls.clone[0]!.source.adapterHandle).toBe(prebuild.adapterHandle)
    expect(w.runtimeState).toMatchObject({ runtime: 'orbstack', prebuildHash: prebuild.hash })
  })
})
