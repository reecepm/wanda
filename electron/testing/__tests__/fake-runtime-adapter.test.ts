import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { WorkenvHandle } from '../../domains/workenv/types/adapter'
import { FakeRuntimeAdapter } from '../fake-runtime-adapter'

const minimalSpec = {
  slug: 'demo',
  config: { runtime: 'orbstack' as const, worktreePath: '/tmp/demo' },
}

function run<A, E>(eff: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(eff as Effect.Effect<A, never>)
}

describe('FakeRuntimeAdapter — basics', () => {
  it('exposes id, version and capabilities', () => {
    const a = new FakeRuntimeAdapter()
    expect(a.id).toBe('orbstack')
    expect(typeof a.version).toBe('string')
    const caps = a.capabilities()
    expect(caps.networking).toBe(true)
    expect(caps.portPublishing).toBe(true)
  })

  it('returns the configured probe result', async () => {
    const a = new FakeRuntimeAdapter()
    a.probeResult = { available: false, error: 'not installed' }
    const r = await run(a.probe())
    expect(r).toEqual({ available: false, error: 'not installed' })
  })

  it('counts probe() invocations', async () => {
    const a = new FakeRuntimeAdapter()
    await run(a.probe())
    await run(a.probe())
    expect(a.calls.probe).toBe(2)
  })
})

describe('FakeRuntimeAdapter — lifecycle records calls', () => {
  it('create() records the spec and returns a handle scoped to runtime', async () => {
    const a = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const handle = await run(a.create(minimalSpec))
    expect(handle.runtime).toBe('orbstack')
    expect(handle.adapterHandle).toContain('demo')
    expect(a.calls.create).toEqual([minimalSpec])
  })

  it('start/stop/destroy each record their handle', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    await run(a.start(h))
    await run(a.stop(h))
    await run(a.destroy(h))
    expect(a.calls.start).toEqual([h])
    expect(a.calls.stop).toEqual([h])
    expect(a.calls.destroy).toEqual([h])
  })

  it('list() reflects created handles minus destroyed ones', async () => {
    const a = new FakeRuntimeAdapter()
    const h1 = await run(a.create({ ...minimalSpec, slug: 'one' }))
    const h2 = await run(a.create({ ...minimalSpec, slug: 'two' }))
    expect(await run(a.list())).toEqual([h1, h2])
    await run(a.destroy(h1))
    expect(await run(a.list())).toEqual([h2])
  })

  it('status() reflects start/stop transitions', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    expect((await run(a.status(h))).running).toBe(false)
    await run(a.start(h))
    expect((await run(a.status(h))).running).toBe(true)
    await run(a.stop(h))
    expect((await run(a.status(h))).running).toBe(false)
  })

  it('rejects start/stop/destroy on an unknown handle', async () => {
    const a = new FakeRuntimeAdapter()
    const ghost: WorkenvHandle = {
      runtime: 'orbstack',
      adapterHandle: 'wanda-ghost',
      state: { runtime: 'orbstack', vmName: 'wanda-ghost', arch: 'arm64' },
    }
    await expect(run(a.start(ghost))).rejects.toThrow(/unknown handle/i)
  })
})

describe('FakeRuntimeAdapter — error injection', () => {
  it('failNext({method}) throws on the next matching method, then clears', async () => {
    const a = new FakeRuntimeAdapter()
    a.failNext = { method: 'create', error: new Error('boom') }
    await expect(run(a.create(minimalSpec))).rejects.toThrow('boom')
    expect(a.failNext).toBeNull()

    // The subsequent create() succeeds.
    const h = await run(a.create(minimalSpec))
    expect(h.adapterHandle).toContain('demo')
  })

  it('failNext only triggers for the requested method', async () => {
    const a = new FakeRuntimeAdapter()
    a.failNext = { method: 'destroy', error: new Error('nope') }
    const h = await run(a.create(minimalSpec))
    await run(a.start(h))
    await run(a.stop(h))
    await expect(run(a.destroy(h))).rejects.toThrow('nope')
  })
})

describe('FakeRuntimeAdapter — programmable exec', () => {
  it('exec() records each call', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    const sess = a.exec(h, { cmd: 'ls', pty: false })
    expect(a.calls.exec).toHaveLength(1)
    expect(a.calls.exec[0]?.req.cmd).toBe('ls')
    sess.destroy()
  })

  it('exec() emits scripted data via onData and resolves exit', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    a.execScript = { data: ['hello\n', 'world\n'], exitCode: 0 }

    const sess = a.exec(h, { cmd: 'echo', pty: true })
    const chunks: string[] = []
    sess.onData((d) => chunks.push(d))

    const code = await sess.exit
    expect(chunks).toEqual(['hello\n', 'world\n'])
    expect(code).toBe(0)
  })

  it('exec() write/resize/signal/destroy are recorded on the session', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    const sess = a.exec(h, { cmd: 'sh', pty: true })
    sess.write('echo hi\n')
    sess.resize(120, 40)
    sess.signal('SIGINT')
    sess.destroy()

    const log = a.execSessions[0]
    expect(log).toBeDefined()
    expect(log?.writes).toEqual(['echo hi\n'])
    expect(log?.resizes).toEqual([{ cols: 120, rows: 40 }])
    expect(log?.signals).toEqual(['SIGINT'])
    expect(log?.destroyed).toBe(true)
  })

  it('exec() carries non-zero exit codes through', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    a.execScript = { data: [], exitCode: 137 }
    const sess = a.exec(h, { cmd: 'crash', pty: false })
    expect(await sess.exit).toBe(137)
  })

  it('two consecutive exec calls each get their own session', async () => {
    const a = new FakeRuntimeAdapter()
    const h = await run(a.create(minimalSpec))
    const s1 = a.exec(h, { cmd: 'a', pty: false })
    const s2 = a.exec(h, { cmd: 'b', pty: false })
    expect(s1.id).not.toBe(s2.id)
    s1.destroy()
    s2.destroy()
  })
})

describe('FakeRuntimeAdapter — capabilities are programmable', () => {
  it('exposes mutated capabilities to the next caller', () => {
    const a = new FakeRuntimeAdapter()
    a.capabilitiesValue = {
      ...a.capabilities(),
      supportsCompose: false,
      portCollisionBehaviour: 'ssh-error',
    }
    const caps = a.capabilities()
    expect(caps.supportsCompose).toBe(false)
    expect(caps.portCollisionBehaviour).toBe('ssh-error')
  })
})
