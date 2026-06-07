import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SubscriptionManager } from '../subscription-manager.ts'
import { FakeConnection, makeEnvelope, sequentialIds } from './helpers.ts'

describe('SubscriptionManager', () => {
  let mgr: SubscriptionManager

  beforeEach(() => {
    mgr = new SubscriptionManager({ newId: sequentialIds(), now: () => 1000 })
  })

  describe('connection lifecycle', () => {
    it('registers and unregisters connections', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      expect(mgr.connectionCount()).toBe(1)
      expect(mgr.unregisterConnection('c1')).toBe(0)
      expect(mgr.connectionCount()).toBe(0)
    })

    it('rejects double-registration of the same id', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      expect(() => mgr.registerConnection(c)).toThrow(/already registered/)
    })

    it('unregisterConnection on unknown id is a no-op', () => {
      expect(mgr.unregisterConnection('nope')).toBe(0)
    })
  })

  describe('subscribe', () => {
    it('creates a subscription and indexes it by connection + resource', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      const sub = mgr.subscribe({
        connectionId: 'c1',
        kind: 'pod-list',
        scope: 'ws-1',
        requestId: 'r1',
      })
      expect(sub.id).toBe('sub-1')
      expect(sub.clientId).toBe('A')
      expect(sub.kind).toBe('pod-list')
      expect(mgr.listByConnection('c1')).toHaveLength(1)
      expect(mgr.listByResource('pod-list', 'ws-1')).toHaveLength(1)
    })

    it('dedups (connectionId, kind, scope, requestId) — same requestId returns same sub', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      const a = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      const b = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      expect(b.id).toBe(a.id)
      expect(mgr.count()).toBe(1)
    })

    it('does NOT dedup across different requestIds', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      const a = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      const b = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r2' })
      expect(a.id).not.toBe(b.id)
      expect(mgr.count()).toBe(2)
    })

    it('does NOT dedup across different connections (each conn gets its own sub)', () => {
      const c1 = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      const c2 = new FakeConnection({ connectionId: 'c2', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c1)
      mgr.registerConnection(c2)
      const a = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      const b = mgr.subscribe({ connectionId: 'c2', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      expect(a.id).not.toBe(b.id)
      expect(mgr.listByResource('pod-list', 'ws-1')).toHaveLength(2)
    })

    it('rejects unknown kind / empty scope / empty requestId', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      // @ts-expect-error — intentional bad kind to exercise the runtime guard.
      expect(() => mgr.subscribe({ connectionId: 'c1', kind: 'bogus', scope: 'x', requestId: 'r' })).toThrow(
        /unknown subscription kind/,
      )
      expect(() => mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: '', requestId: 'r' })).toThrow()
      expect(() => mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'x', requestId: '' })).toThrow()
    })

    it('rejects subscribe for an unknown connection', () => {
      expect(() => mgr.subscribe({ connectionId: 'ghost', kind: 'pod-list', scope: 'x', requestId: 'r' })).toThrow(
        /unknown connection/,
      )
    })
  })

  describe('unsubscribe', () => {
    it('removes the subscription from all indexes', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      const sub = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      expect(mgr.unsubscribe(sub.id)).toBe(true)
      expect(mgr.count()).toBe(0)
      expect(mgr.listByConnection('c1')).toEqual([])
      expect(mgr.listByResource('pod-list', 'ws-1')).toEqual([])
    })

    it('re-subscribing with the same requestId after unsubscribe creates a new sub', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      const a = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      mgr.unsubscribe(a.id)
      const b = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      expect(b.id).not.toBe(a.id)
    })

    it('returns false for unknown ids', () => {
      expect(mgr.unsubscribe('ghost')).toBe(false)
    })
  })

  describe('connection-scoped cleanup', () => {
    it('unregisterConnection drops every subscription on that connection', () => {
      const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(c)
      mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r1' })
      mgr.subscribe({ connectionId: 'c1', kind: 'pod-details', scope: 'pod-1', requestId: 'r2' })
      const count = mgr.unregisterConnection('c1')
      expect(count).toBe(2)
      expect(mgr.count()).toBe(0)
      expect(mgr.listByResource('pod-list', 'ws-1')).toEqual([])
      expect(mgr.listByResource('pod-details', 'pod-1')).toEqual([])
    })

    it('does not touch subscriptions on other connections', () => {
      const c1 = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
      const c2 = new FakeConnection({ connectionId: 'c2', clientId: 'B', sessionId: 's2' })
      mgr.registerConnection(c1)
      mgr.registerConnection(c2)
      mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'ws-1', requestId: 'r' })
      mgr.subscribe({ connectionId: 'c2', kind: 'pod-list', scope: 'ws-1', requestId: 'r' })
      mgr.unregisterConnection('c1')
      expect(mgr.count()).toBe(1)
      expect(mgr.listByResource('pod-list', 'ws-1')).toHaveLength(1)
    })
  })

  describe('publishEvent routing', () => {
    it('delivers to subscribers whose (kind, scope) matches only', () => {
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      const b = new FakeConnection({ connectionId: 'b', clientId: 'B', sessionId: 's2' })
      const c = new FakeConnection({ connectionId: 'c', clientId: 'C', sessionId: 's3' })
      mgr.registerConnection(a)
      mgr.registerConnection(b)
      mgr.registerConnection(c)

      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'ws-1', requestId: 'r' })
      mgr.subscribe({ connectionId: 'b', kind: 'pod-list', scope: 'ws-1', requestId: 'r' })
      mgr.subscribe({ connectionId: 'c', kind: 'pod-list', scope: 'ws-2', requestId: 'r' })

      const env = makeEnvelope('event:pod:created', 42)
      const result = mgr.publishEvent('pod-list', 'ws-1', env)

      expect(result).toEqual({ delivered: 2, dropped: 0 })
      expect(a.sent).toHaveLength(1)
      expect(b.sent).toHaveLength(1)
      expect(c.sent).toHaveLength(0) // different scope
    })

    it('returns 0,0 when no subscribers match', () => {
      const result = mgr.publishEvent('pod-list', 'nobody', makeEnvelope('event:pod:created'))
      expect(result).toEqual({ delivered: 0, dropped: 0 })
    })

    it('applies backpressure: drops events when bufferedAmount > threshold', () => {
      mgr = new SubscriptionManager({
        newId: sequentialIds(),
        backpressureThresholdBytes: 1000,
      })
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(a)
      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'x', requestId: 'r' })

      a.setBuffered(5000)
      const result = mgr.publishEvent('pod-list', 'x', makeEnvelope('event:pod:created'))
      expect(result).toEqual({ delivered: 0, dropped: 1 })
      expect(a.sent).toHaveLength(0)
      expect(mgr.droppedEvents()).toBe(1)

      a.setBuffered(0)
      const recover = mgr.publishEvent('pod-list', 'x', makeEnvelope('event:pod:updated'))
      expect(recover).toEqual({ delivered: 1, dropped: 0 })
    })

    it('counts a throwing send as dropped (transport already dead)', () => {
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(a)
      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'x', requestId: 'r' })
      a.failNextSend()
      const result = mgr.publishEvent('pod-list', 'x', makeEnvelope('event:pod:created'))
      expect(result).toEqual({ delivered: 0, dropped: 1 })
    })

    it('does not hand events to a connection that has been unregistered', () => {
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(a)
      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'x', requestId: 'r' })
      mgr.unregisterConnection('a')
      const result = mgr.publishEvent('pod-list', 'x', makeEnvelope('event:pod:created'))
      expect(result).toEqual({ delivered: 0, dropped: 0 })
      expect(a.sent).toHaveLength(0)
    })
  })

  describe('publishBinary routing', () => {
    it('delivers to terminal-stream subscribers regardless of backpressure', () => {
      mgr = new SubscriptionManager({
        newId: sequentialIds(),
        backpressureThresholdBytes: 100,
      })
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(a)
      mgr.subscribe({ connectionId: 'a', kind: 'terminal-stream', scope: 'pty-1', requestId: 'r' })
      a.setBuffered(5000)
      const delivered = mgr.publishBinary('pty-1', new Uint8Array([1, 2, 3]))
      expect(delivered).toBe(1)
      expect(a.binary).toHaveLength(1)
    })

    it('only hits terminal-stream subs, not other kinds on same scope', () => {
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      const b = new FakeConnection({ connectionId: 'b', clientId: 'B', sessionId: 's2' })
      mgr.registerConnection(a)
      mgr.registerConnection(b)
      mgr.subscribe({ connectionId: 'a', kind: 'terminal-stream', scope: 'pty-1', requestId: 'r' })
      mgr.subscribe({ connectionId: 'b', kind: 'pod-details', scope: 'pty-1', requestId: 'r' })
      mgr.publishBinary('pty-1', new Uint8Array([0xaa]))
      expect(a.binary).toHaveLength(1)
      expect(b.binary).toHaveLength(0)
    })
  })

  describe('inspection', () => {
    it('count() reflects live subscriptions', () => {
      const a = new FakeConnection({ connectionId: 'a', clientId: 'A', sessionId: 's1' })
      mgr.registerConnection(a)
      expect(mgr.count()).toBe(0)
      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'x', requestId: 'r1' })
      mgr.subscribe({ connectionId: 'a', kind: 'pod-list', scope: 'y', requestId: 'r2' })
      expect(mgr.count()).toBe(2)
    })

    it('getById returns null for unknown ids', () => {
      expect(mgr.getById('nope')).toBeNull()
    })
  })
})

describe('SubscriptionManager · default newId', () => {
  it('uses a randomized id when none is supplied', () => {
    const mgr = new SubscriptionManager()
    const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
    mgr.registerConnection(c)
    const s = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'x', requestId: 'r1' })
    expect(s.id).toMatch(/^[a-f0-9]{32}$/)
  })
})

describe('SubscriptionManager · now', () => {
  it('stamps subscriptions with the configured clock', () => {
    const now = vi.fn(() => 12345)
    const mgr = new SubscriptionManager({ newId: sequentialIds(), now })
    const c = new FakeConnection({ connectionId: 'c1', clientId: 'A', sessionId: 's1' })
    mgr.registerConnection(c)
    const s = mgr.subscribe({ connectionId: 'c1', kind: 'pod-list', scope: 'x', requestId: 'r1' })
    expect(s.createdAt).toBe(12345)
    expect(now).toHaveBeenCalled()
  })
})
