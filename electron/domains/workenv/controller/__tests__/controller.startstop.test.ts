import { join } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
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
import { WorkenvTemplatesLive } from '../templates'
import { prebuildCacheKeyForConfig, WorkenvController, WorkenvControllerLive } from '../workenv'

function setup() {
  const adapter = new FakeRuntimeAdapter({ runtime: 'orbstack' })
  const dbRef: { current?: ReturnType<typeof drizzle> } = {}
  const dbLayer = Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../../../../db/migrations'))
    dbRef.current = db
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
  return { runtime: ManagedRuntime.make(layer), adapter, tracker, dbRef }
}

const minimalConfig = { runtime: 'orbstack' as const, worktreePath: '/tmp/demo' }

async function setupCreated() {
  const ctx = setup()
  const ctl = await ctx.runtime.runPromise(WorkenvController)
  const w = await ctx.runtime.runPromise(ctl.create({ name: 'demo', slug: 'demo', config: minimalConfig }))
  ctx.tracker.clear()
  return { ...ctx, ctl, workenv: w }
}

describe('WorkenvController.start', () => {
  it('drives stopped → starting → running and calls adapter.start', async () => {
    const { runtime, adapter, ctl, workenv, tracker } = await setupCreated()
    await runtime.runPromise(ctl.start(workenv.id))

    const after = await runtime.runPromise(ctl.getById(workenv.id))
    expect(after?.state).toBe('running')
    expect(after?.lastStartedAt).toBeInstanceOf(Date)

    expect(adapter.calls.start).toHaveLength(1)
    expect(adapter.calls.start[0]!.adapterHandle).toBe(workenv.adapterHandle)

    expect(tracker.sendsOn('workenv.state.changed')).toEqual([
      [workenv.id, 'stopped', 'starting'],
      [workenv.id, 'starting', 'running'],
    ])
  })

  it('start is idempotent for a workenv that is already running', async () => {
    const { runtime, ctl, workenv } = await setupCreated()
    const first = await runtime.runPromise(ctl.start(workenv.id))
    const second = await runtime.runPromise(ctl.start(workenv.id))
    expect(second.id).toBe(first.id)
    expect(second.state).toBe('running')
  })

  it('rejects start on an unknown id', async () => {
    const { runtime, ctl } = await setupCreated()
    const result = await runtime.runPromise(ctl.start('missing')).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/not found/i)
  })

  it('on adapter.start failure → state=error, lastError set', async () => {
    const { runtime, adapter, ctl, workenv } = await setupCreated()
    adapter.failNext = { method: 'start', error: new Error('docker daemon down') }

    await runtime.runPromise(ctl.start(workenv.id)).catch(() => undefined)

    const after = await runtime.runPromise(ctl.getById(workenv.id))
    expect(after?.state).toBe('error')
    expect(after?.lastError).toMatch(/docker daemon down/)
  })

  it('after error → start retries and can succeed', async () => {
    const { runtime, adapter, ctl, workenv } = await setupCreated()
    adapter.failNext = { method: 'start', error: new Error('first try fails') }
    await runtime.runPromise(ctl.start(workenv.id)).catch(() => undefined)
    expect((await runtime.runPromise(ctl.getById(workenv.id)))?.state).toBe('error')

    // Second attempt succeeds.
    await runtime.runPromise(ctl.start(workenv.id))
    expect((await runtime.runPromise(ctl.getById(workenv.id)))?.state).toBe('running')
  })

  it('uses persisted layer definitions at start time even when ids match built-ins', async () => {
    // Workenv templates can customize a built-in layer id with
    // project-specific params or install commands. Start must execute the
    // persisted definition, not silently replace it with the current
    // catalog entry for the same id.
    const ctx = setup()
    const ctl = await ctx.runtime.runPromise(WorkenvController)
    const w = await ctx.runtime.runPromise(
      ctl.create({
        name: 'b',
        slug: 'b',
        config: {
          ...minimalConfig,
          layers: [
            {
              kind: 'tool',
              id: 'tool:go',
              name: 'Custom Go',
              params: { version: '1.26.1' },
              install: [{ run: `echo custom-go-$${'{param.version}'}` }],
            },
          ],
        },
      }),
    )

    await ctx.runtime.runPromise(ctl.start(w.id))

    const execCommands = ctx.adapter.calls.exec.map((c) => c.req.args?.[1] ?? '')
    expect(execCommands).toContain('echo custom-go-1.26.1')
    expect(execCommands.some((c) => c.includes('go1.26.0.linux-arm64.tar.gz'))).toBe(false)
  })

  it('runs prebuildable layers when the cloned prebuild hash is stale', async () => {
    const ctx = setup()
    const ctl = await ctx.runtime.runPromise(WorkenvController)
    const w = await ctx.runtime.runPromise(
      ctl.create({
        name: 'b',
        slug: 'b',
        config: {
          ...minimalConfig,
          layers: [
            {
              kind: 'pkg',
              id: 'pkg:postgresql-client',
              manager: 'apt',
              packages: ['postgresql-client'],
            },
          ],
        },
      }),
    )
    ctx.dbRef.current
      ?.update(schema.workenvs)
      .set({
        runtimeState: {
          runtime: 'orbstack',
          vmName: w.adapterHandle ?? 'wanda-b',
          arch: 'arm64',
          prebuildHash: 'stale-prebuild',
        },
      })
      .where(eq(schema.workenvs.id, w.id))
      .run()

    await ctx.runtime.runPromise(ctl.start(w.id))

    const execCommands = ctx.adapter.calls.exec.map((c) => c.req.args?.[1] ?? '')
    expect(execCommands).toContain('apt-get update && apt-get install -y postgresql-client')
  })

  it('runs postStart steps after user bootstrap steps before marking running', async () => {
    const ctx = setup()
    const ctl = await ctx.runtime.runPromise(WorkenvController)
    const w = await ctx.runtime.runPromise(
      ctl.create({
        name: 'b',
        slug: 'b',
        config: {
          ...minimalConfig,
          bootstrap: [{ kind: 'shell', run: 'echo bootstrap' }],
          postStart: [
            {
              kind: 'shell',
              label: 'Seed project',
              run: './scripts/seed.sh',
              cwd: `$${'{WANDA_WORKTREE_PATH}'}/platform`,
              asUser: 'dev',
            },
          ],
        },
      }),
    )

    await ctx.runtime.runPromise(ctl.start(w.id))

    expect(ctx.adapter.calls.exec.map((c) => c.req.args?.[1] ?? c.req.args?.[0])).toEqual([
      'echo bootstrap',
      './scripts/seed.sh',
    ])
    expect(ctx.adapter.calls.exec[1]!.req.cwd).toBe(`${w.worktreePath}/platform`)
    expect(ctx.adapter.calls.exec[1]!.req.runAs).toBe('dev')
    expect((await ctx.runtime.runPromise(ctl.getById(w.id)))?.state).toBe('running')
  })

  it('skips steps marked skipWhenPrebuilt when starting from a current prebuild clone', async () => {
    const ctx = setup()
    const ctl = await ctx.runtime.runPromise(WorkenvController)
    const w = await ctx.runtime.runPromise(
      ctl.create({
        name: 'b',
        slug: 'b',
        config: {
          ...minimalConfig,
          base: { image: 'ubuntu:24.04' },
          layers: [
            {
              kind: 'base',
              id: 'base:ubuntu-24',
              image: 'ubuntu:24.04',
              install: [{ run: 'echo install-base', idempotencyKey: 'base' }],
            },
          ],
          prebuild: [{ kind: 'shell', run: 'echo prebuild-project' }],
          postStart: [
            { kind: 'shell', label: 'Seed project', run: 'task seed', skipWhenPrebuilt: true },
            { kind: 'shell', label: 'Always verify', run: 'task verify' },
          ],
        },
      }),
    )

    ctx.dbRef.current
      ?.update(schema.workenvs)
      .set({
        runtimeState: {
          runtime: 'orbstack',
          vmName: w.adapterHandle ?? 'wanda-b',
          arch: 'arm64',
          prebuildHash: prebuildCacheKeyForConfig(w.config),
        },
      })
      .where(eq(schema.workenvs.id, w.id))
      .run()

    ctx.adapter.calls.exec.length = 0
    await ctx.runtime.runPromise(ctl.start(w.id))

    expect(ctx.adapter.calls.exec.map((c) => c.req.args?.[1] ?? c.req.args?.[0])).toEqual(['task verify'])
  })

  it('on bootstrap step failure → state=error AND start fails the Effect', async () => {
    // Workenv with a bootstrap step that the adapter will exec → fail.
    const ctx = setup()
    const ctl = await ctx.runtime.runPromise(WorkenvController)
    const w = await ctx.runtime.runPromise(
      ctl.create({
        name: 'b',
        slug: 'b',
        config: {
          ...minimalConfig,
          bootstrap: [{ kind: 'shell', run: 'apt-get install -y nonexistent-pkg' }],
        },
      }),
    )
    ctx.adapter.failNext = { method: 'exec', error: new Error('package not found') }

    const result = await ctx.runtime.runPromise(ctl.start(w.id)).catch((e) => e as Error)
    // Critical: the Effect must FAIL, not return a row in 'error' state —
    // otherwise pod auto-start (which uses Effect.either) treats it as
    // success and tries to exec terminals against a half-broken VM.
    expect(result).toBeInstanceOf(Error)

    const after = await ctx.runtime.runPromise(ctl.getById(w.id))
    expect(after?.state).toBe('error')
    expect(after?.lastError).toBeTruthy()
  })
})

describe('WorkenvController.stop', () => {
  it('drives running → stopping → stopped and calls adapter.stop', async () => {
    const { runtime, adapter, ctl, workenv, tracker } = await setupCreated()
    await runtime.runPromise(ctl.start(workenv.id))
    tracker.clear()

    await runtime.runPromise(ctl.stop(workenv.id))

    const after = await runtime.runPromise(ctl.getById(workenv.id))
    expect(after?.state).toBe('stopped')
    expect(after?.lastStoppedAt).toBeInstanceOf(Date)

    expect(adapter.calls.stop).toHaveLength(1)
    expect(tracker.sendsOn('workenv.state.changed')).toEqual([
      [workenv.id, 'running', 'stopping'],
      [workenv.id, 'stopping', 'stopped'],
    ])
  })

  it('rejects stop on a stopped workenv', async () => {
    const { runtime, ctl, workenv } = await setupCreated()
    const result = await runtime.runPromise(ctl.stop(workenv.id)).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
  })

  it('rejects stop on an unknown id', async () => {
    const { runtime, ctl } = await setupCreated()
    const result = await runtime.runPromise(ctl.stop('missing')).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
  })

  it('on adapter.stop failure → state=error, lastError set', async () => {
    const { runtime, adapter, ctl, workenv } = await setupCreated()
    await runtime.runPromise(ctl.start(workenv.id))
    adapter.failNext = { method: 'stop', error: new Error('vm not responding') }

    await runtime.runPromise(ctl.stop(workenv.id)).catch(() => undefined)
    const after = await runtime.runPromise(ctl.getById(workenv.id))
    expect(after?.state).toBe('error')
    expect(after?.lastError).toMatch(/vm not responding/)
  })
})

describe('WorkenvController.restart', () => {
  it('drives running → stopping → stopped → starting → running', async () => {
    const { runtime, ctl, workenv, tracker } = await setupCreated()
    await runtime.runPromise(ctl.start(workenv.id))
    tracker.clear()

    await runtime.runPromise(ctl.restart(workenv.id))

    const after = await runtime.runPromise(ctl.getById(workenv.id))
    expect(after?.state).toBe('running')

    expect(tracker.sendsOn('workenv.state.changed')).toEqual([
      [workenv.id, 'running', 'stopping'],
      [workenv.id, 'stopping', 'stopped'],
      [workenv.id, 'stopped', 'starting'],
      [workenv.id, 'starting', 'running'],
    ])
  })

  it('restart on a stopped workenv just starts it', async () => {
    const { runtime, ctl, workenv } = await setupCreated()
    await runtime.runPromise(ctl.restart(workenv.id))
    expect((await runtime.runPromise(ctl.getById(workenv.id)))?.state).toBe('running')
  })

  it('restart on an error-state workenv succeeds (recovery path)', async () => {
    const { runtime, adapter, ctl, workenv } = await setupCreated()
    adapter.failNext = { method: 'start', error: new Error('first boot failed') }
    await runtime.runPromise(ctl.start(workenv.id)).catch(() => undefined)
    expect((await runtime.runPromise(ctl.getById(workenv.id)))?.state).toBe('error')

    await runtime.runPromise(ctl.restart(workenv.id))
    expect((await runtime.runPromise(ctl.getById(workenv.id)))?.state).toBe('running')
  })

  it('rejects restart on unknown id', async () => {
    const { runtime, ctl } = await setupCreated()
    const result = await runtime.runPromise(ctl.restart('missing')).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
  })
})
