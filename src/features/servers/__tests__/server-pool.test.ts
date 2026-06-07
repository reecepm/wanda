// Per-paired-server connection pool tests.
//
// Tests the memoization + cache eviction logic against a stub factory —
// the real factory (`createPairedServerClient`) is exercised end-to-end
// in `server-connection.test.ts`.

import { describe, expect, it, vi } from 'vitest'
import type { PairedServerView } from '../../../../electron/preload/api'
import type { PairedServerClient } from '../server-connection'
import { createServerPool } from '../server-pool'

function makeServer(id: string, base: string): PairedServerView {
  return {
    id,
    serverId: `srv-${id}`,
    label: `Server ${id}`,
    baseUrl: base,
    addedAt: 0,
    lastConnectedAt: null,
  }
}

function makeStubClient(tag: string): PairedServerClient {
  return {
    client: { __stub: tag } as unknown as PairedServerClient['client'],
    setSessionToken: vi.fn(),
  }
}

describe('createServerPool', () => {
  it('builds a client per server and caches it across calls', async () => {
    const factory = vi.fn((opts: { baseUrl: string }) => makeStubClient(opts.baseUrl))
    const pool = createServerPool({
      getSessionToken: async (id) => `tok-${id}`,
      clientFactory: factory,
    })

    const a = makeServer('a', 'http://a:1')
    const b = makeServer('b', 'http://b:2')

    const c1 = await pool.clientFor(a)
    const c2 = await pool.clientFor(a)
    const cB = await pool.clientFor(b)

    expect(c1).toBe(c2) // memoized
    expect(c1).not.toBe(cB)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('drops the cached client when the baseUrl changes', async () => {
    const factory = vi.fn(() => makeStubClient('x'))
    const pool = createServerPool({
      getSessionToken: async () => 'tok',
      clientFactory: factory,
    })

    const a1 = makeServer('a', 'http://a:1')
    const a2 = { ...a1, baseUrl: 'http://a:2' }

    const c1 = await pool.clientFor(a1)
    const c2 = await pool.clientFor(a2)

    expect(c1).not.toBe(c2)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('forgets a server when remove() is called', async () => {
    const factory = vi.fn(() => makeStubClient('x'))
    const pool = createServerPool({
      getSessionToken: async () => 'tok',
      clientFactory: factory,
    })

    const a = makeServer('a', 'http://a:1')
    await pool.clientFor(a)
    pool.remove(a.id)
    await pool.clientFor(a)

    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('rejects with a descriptive error when getSessionToken returns null', async () => {
    const factory = vi.fn(() => makeStubClient('x'))
    const pool = createServerPool({
      getSessionToken: async () => null,
      clientFactory: factory,
    })
    const a = makeServer('a', 'http://a:1')
    await expect(pool.clientFor(a)).rejects.toThrow(/no session token/)
  })

  it('clear() drops every cached entry', async () => {
    const factory = vi.fn(() => makeStubClient('x'))
    const pool = createServerPool({
      getSessionToken: async () => 'tok',
      clientFactory: factory,
    })
    await pool.clientFor(makeServer('a', 'http://a:1'))
    await pool.clientFor(makeServer('b', 'http://b:2'))
    pool.clear()
    await pool.clientFor(makeServer('a', 'http://a:1'))
    expect(factory).toHaveBeenCalledTimes(3)
  })
})
