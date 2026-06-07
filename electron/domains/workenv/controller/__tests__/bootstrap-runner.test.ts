import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkenvBootstrapStep } from '../../../../../shared/contracts/workenv'
import { runMigrations } from '../../../../db/migrate'
import * as schema from '../../../../db/schema'
import * as taskSchema from '../../../../db/task-schema'
import { DatabaseService } from '../../../../infra/database'
import { makeTestBroadcasterLayer } from '../../../../testing/broadcaster-tracker'
import { FakeRuntimeAdapter } from '../../../../testing/fake-runtime-adapter'
import { createWorkenv, listEventsForWorkenv } from '../../repository'
import { BootstrapRunner, BootstrapRunnerLive } from '../bootstrap-runner'
import { WorkenvEventsLive } from '../events'

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
  const events = WorkenvEventsLive.pipe(Layer.provideMerge(Layer.mergeAll(dbLayer, broadcasterLayer)))
  const layer = BootstrapRunnerLive.pipe(Layer.provideMerge(events))
  return { runtime: ManagedRuntime.make(layer), adapter, tracker }
}

async function makeWorkenv(
  runtime: ReturnType<typeof setup>['runtime'],
  adapter: FakeRuntimeAdapter,
  envOverrides: Record<string, string> = {},
  slug = 'demo',
) {
  const db = await runtime.runPromise(DatabaseService)
  const handle = await Effect.runPromise(
    adapter.create({ slug, config: { runtime: 'orbstack', worktreePath: `/tmp/${slug}` } }),
  )
  const w = createWorkenv(db, {
    name: slug,
    slug,
    worktreePath: `/tmp/${slug}`,
    runtime: 'orbstack',
    configHash: 'h0',
    config: { runtime: 'orbstack', worktreePath: `/tmp/${slug}`, env: envOverrides },
    state: 'starting',
    adapterHandle: handle.adapterHandle,
    runtimeState: handle.state,
  })
  return { workenv: w, handle }
}

function runBootstrap(
  runtime: ReturnType<typeof setup>['runtime'],
  workenvId: string,
  steps: readonly WorkenvBootstrapStep[],
  handle: import('../../types/adapter').WorkenvHandle,
  adapter: FakeRuntimeAdapter,
) {
  return runtime.runPromise(BootstrapRunner.pipe(Effect.flatMap((s) => s.run(workenvId, steps, handle, adapter))))
}

describe('BootstrapRunner', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  let adapter: FakeRuntimeAdapter
  let tracker: ReturnType<typeof setup>['tracker']

  beforeEach(() => {
    ;({ runtime, adapter, tracker } = setup())
    adapter.execScript = { data: [], exitCode: 0 }
  })

  it('runs steps sequentially in declared order', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    const r = await runBootstrap(
      runtime,
      workenv.id,
      [
        { kind: 'shell', run: 'echo a' },
        { kind: 'shell', run: 'echo b' },
        { kind: 'shell', run: 'echo c' },
      ],
      handle,
      adapter,
    )

    expect(r.succeeded).toBe(3)
    expect(r.failed).toBe(0)
    expect(r.total).toBe(3)
    expect(r.failedStep).toBeUndefined()

    expect(adapter.calls.exec).toHaveLength(3)
    expect(adapter.calls.exec[0]!.req.args).toEqual(['-c', 'echo a'])
    expect(adapter.calls.exec[1]!.req.args).toEqual(['-c', 'echo b'])
    expect(adapter.calls.exec[2]!.req.args).toEqual(['-c', 'echo c'])
  })

  it('broadcasts workenv.bootstrap.progress for started + succeeded per step', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    await runBootstrap(
      runtime,
      workenv.id,
      [
        { kind: 'shell', label: 'Say x', run: 'echo x' },
        { kind: 'shell', run: 'echo y' },
      ],
      handle,
      adapter,
    )

    const sends = tracker.sendsOn('workenv.bootstrap.progress')
    expect(sends).toEqual([
      [workenv.id, 0, 'Say x', 'started'],
      [workenv.id, 0, 'Say x', 'succeeded'],
      [workenv.id, 1, 'shell: echo y', 'started'],
      [workenv.id, 1, 'shell: echo y', 'succeeded'],
    ])
  })

  it('persists bootstrap.started, per-step events, and bootstrap.completed', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    await runBootstrap(runtime, workenv.id, [{ kind: 'shell', run: 'echo a' }], handle, adapter)
    const db = await runtime.runPromise(DatabaseService)
    const types = listEventsForWorkenv(db, workenv.id)
      .map((e) => e.type)
      .sort()
    expect(types).toEqual(
      ['bootstrap.started', 'bootstrap.step.started', 'bootstrap.step.completed', 'bootstrap.completed'].sort(),
    )
  })

  it('aborts after the first failing step (subsequent steps skipped)', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)

    let callCount = 0
    const origExec = adapter.exec.bind(adapter)
    adapter.exec = (h, req) => {
      callCount += 1
      const sess = origExec(h, req)
      if (callCount === 2) {
        ;(sess as unknown as { exit: Promise<number> }).exit = Promise.resolve(137)
      }
      return sess
    }

    const r = await runBootstrap(
      runtime,
      workenv.id,
      [
        { kind: 'shell', run: 'good 1' },
        { kind: 'shell', run: 'fail' },
        { kind: 'shell', run: 'never runs' },
      ],
      handle,
      adapter,
    )

    expect(r.succeeded).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.total).toBe(3)
    expect(r.failedStep?.index).toBe(1)
    expect(callCount).toBe(2)
  })

  it('interpolates env placeholders in shell commands from workenv config env', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter, { GREETING: 'hello', NAME: 'wanda' })
    await runBootstrap(
      runtime,
      workenv.id,
      [{ kind: 'shell', run: `echo $${'{GREETING}'} $${'{NAME}'}` }],
      handle,
      adapter,
    )
    expect(adapter.calls.exec[0]!.req.args).toEqual(['-c', 'echo hello wanda'])
  })

  it('injects Wanda runtime env vars for interpolation and exec env', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    await runBootstrap(
      runtime,
      workenv.id,
      [
        {
          kind: 'shell',
          run: `echo $${'{WANDA_WORKTREE_PATH}'}`,
          cwd: `$${'{WANDA_WORKTREE_PATH}'}/platform`,
        },
      ],
      handle,
      adapter,
    )
    expect(adapter.calls.exec[0]!.req.args).toEqual(['-c', `echo ${workenv.worktreePath}`])
    expect(adapter.calls.exec[0]!.req.cwd).toBe(`${workenv.worktreePath}/platform`)
    expect(adapter.calls.exec[0]!.req.env).toMatchObject({
      WANDA_WORKENV_ID: workenv.id,
      WANDA_WORKENV_NAME: workenv.name,
      WANDA_WORKENV_SLUG: workenv.slug,
      WANDA_WORKTREE_PATH: workenv.worktreePath,
    })
  })

  it('leaves unknown env placeholders untouched', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter, { KNOWN: 'yes' })
    await runBootstrap(
      runtime,
      workenv.id,
      [{ kind: 'shell', run: `echo $${'{KNOWN}'} $${'{UNKNOWN}'}` }],
      handle,
      adapter,
    )
    expect(adapter.calls.exec[0]!.req.args).toEqual(['-c', `echo yes $${'{UNKNOWN}'}`])
  })

  it('runs script steps via /bin/sh <path>', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    await runBootstrap(
      runtime,
      workenv.id,
      [{ kind: 'script', path: `$${'{WANDA_WORKTREE_PATH}'}/bootstrap.sh`, cwd: '/work', asUser: 'dev' }],
      handle,
      adapter,
    )
    expect(adapter.calls.exec[0]!.req.cmd).toBe('/bin/sh')
    expect(adapter.calls.exec[0]!.req.args).toEqual([`${workenv.worktreePath}/bootstrap.sh`])
    expect(adapter.calls.exec[0]!.req.cwd).toBe('/work')
    expect(adapter.calls.exec[0]!.req.runAs).toBe('dev')
  })

  it('streams hostScript steps into the guest shell', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    const dir = mkdtempSync(join(tmpdir(), 'wanda-host-script-'))
    const scriptPath = join(dir, 'seed.sh')
    writeFileSync(scriptPath, 'echo generic host script\n')
    chmodSync(scriptPath, 0o755)
    mkdirSync(join(workenv.worktreePath, 'service'), { recursive: true })

    await runBootstrap(
      runtime,
      workenv.id,
      [
        {
          kind: 'hostScript',
          path: scriptPath,
          cwd: `$${'{WANDA_WORKTREE_PATH}'}/service`,
          asUser: 'dev',
        },
      ],
      handle,
      adapter,
    )

    expect(adapter.calls.exec[0]!.req.cmd).toBe('/bin/sh')
    expect(adapter.calls.exec[0]!.req.args?.[0]).toBe('-c')
    expect(adapter.calls.exec[0]!.req.args?.[1]).toContain('base64 -d | /bin/sh')
    expect(adapter.calls.exec[0]!.req.cwd).toBe(`${workenv.worktreePath}/service`)
    expect(adapter.calls.exec[0]!.req.runAs).toBe('dev')
  })

  it('rejects recipe steps with a clear error (not implemented in v1)', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    const r = await runBootstrap(runtime, workenv.id, [{ kind: 'recipe', ref: 'recipes/postgres' }], handle, adapter)
    expect(r.failed).toBe(1)
    expect(r.failedStep?.error).toMatch(/recipe/i)
  })

  it('skips steps whose idempotencyKey already appears in completed history', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    const r1 = await runBootstrap(
      runtime,
      workenv.id,
      [{ kind: 'shell', run: 'install', idempotencyKey: 'install-v1' }],
      handle,
      adapter,
    )
    expect(r1.succeeded).toBe(1)
    expect(adapter.calls.exec).toHaveLength(1)

    const r2 = await runBootstrap(
      runtime,
      workenv.id,
      [{ kind: 'shell', run: 'install', idempotencyKey: 'install-v1' }],
      handle,
      adapter,
    )
    expect(r2.succeeded).toBe(0)
    expect(r2.total).toBe(1)
    expect(adapter.calls.exec).toHaveLength(1)
  })

  it('an empty steps array succeeds vacuously without emitting per-step events', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter)
    const r = await runBootstrap(runtime, workenv.id, [], handle, adapter)
    expect(r).toEqual({ succeeded: 0, failed: 0, total: 0, failedStep: undefined })
    expect(tracker.sendsOn('workenv.bootstrap.progress')).toEqual([])
    const db = await runtime.runPromise(DatabaseService)
    expect(listEventsForWorkenv(db, workenv.id)).toHaveLength(0)
  })

  it('passes the workenv config env as exec env', async () => {
    const { workenv, handle } = await makeWorkenv(runtime, adapter, { FOO: 'bar' })
    await runBootstrap(runtime, workenv.id, [{ kind: 'shell', run: 'env' }], handle, adapter)
    expect(adapter.calls.exec[0]!.req.env).toMatchObject({ FOO: 'bar' })
  })
})
