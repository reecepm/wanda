import { Effect } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntimeAdapter } from '../../testing/fake-runtime-adapter'
import { RuntimeRegistry } from '../runtime-registry.service'

const run = <A>(eff: Effect.Effect<A>) => Effect.runPromise(eff)

describe('RuntimeRegistry', () => {
  let now = 0
  const clock = () => now

  beforeEach(() => {
    now = 0
  })

  it('get(runtime) returns the registered adapter', () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], now: clock })
    expect(reg.get('orbstack')).toBe(orb)
  })

  it('get returns undefined for an unregistered runtime', () => {
    const reg = new RuntimeRegistry({ adapters: [], now: clock })
    expect(reg.get('orbstack')).toBeUndefined()
  })

  it('list() returns all registered adapters in registration order', () => {
    const a = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [a], now: clock })
    expect(reg.list()).toEqual([a])
  })

  it('probe() returns the adapter probe result', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    orb.probeResult = { available: true, version: 'orb-1.2.3' }
    const reg = new RuntimeRegistry({ adapters: [orb], now: clock })
    const r = await run(reg.probe('orbstack'))
    expect(r).toEqual({ available: true, version: 'orb-1.2.3' })
  })

  it('probe() caches the result for the configured TTL window', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], probeTtlMs: 5000, now: clock })

    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    // Within the TTL window: cached.
    now = 4999
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    // Just past the TTL: re-probe.
    now = 5001
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(2)
  })

  it('probe() returns a not-available result for an unregistered runtime', async () => {
    const reg = new RuntimeRegistry({ adapters: [], now: clock })
    const r = await run(reg.probe('orbstack'))
    expect(r.available).toBe(false)
    expect(r.error).toMatch(/not registered|no adapter/i)
  })

  it('invalidate() clears the cache for one runtime', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], probeTtlMs: 5000, now: clock })

    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    reg.invalidate('orbstack')
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(2)
  })

  it('invalidate() with no arg clears every cached entry', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], probeTtlMs: 5000, now: clock })

    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    reg.invalidate()
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(2)
  })

  it('probeAll() returns a map keyed by runtime', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    orb.probeResult = { available: true, version: '1.0' }
    const reg = new RuntimeRegistry({ adapters: [orb], now: clock })

    const all = await run(reg.probeAll())
    expect(all).toEqual({
      orbstack: { available: true, version: '1.0' },
    })
  })

  it('probeAll() reuses the cache for already-probed runtimes', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], probeTtlMs: 5000, now: clock })

    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    await run(reg.probeAll())
    expect(orb.calls.probe).toBe(1)
  })

  it('default TTL is 5 seconds', async () => {
    const orb = new FakeRuntimeAdapter({ runtime: 'orbstack' })
    const reg = new RuntimeRegistry({ adapters: [orb], now: clock })

    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    now = 4999
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(1)

    now = 5001
    await run(reg.probe('orbstack'))
    expect(orb.calls.probe).toBe(2)
  })
})
