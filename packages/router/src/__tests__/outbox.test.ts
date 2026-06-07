import { podRef, workspaceRef } from '@wanda/wire'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OutboxEntryNotFoundError } from '../errors.ts'
import { IDEMPOTENCY_VERSION, makeIdempotencyKey } from '../idempotency-key.ts'
import { reopen, type TempRouter, tempRouter } from './helpers.ts'

describe('Outbox', () => {
  let ctx: TempRouter
  afterEach(() => ctx?.cleanup())

  describe('enqueue', () => {
    it('persists a mutation and returns the full entry', () => {
      ctx = tempRouter({ now: () => 1000 })
      const e = ctx.outbox.enqueue({
        method: 'pod.rename',
        input: { id: 'p1', name: 'renamed' },
        ref: podRef('srv-1', 'p1'),
      })
      expect(e.method).toBe('pod.rename')
      expect(e.createdAt).toBe(1000)
      expect(e.retries).toBe(0)
      expect(e.lastError).toBeNull()
      expect(e.ref?.kind).toBe('pod')
      expect(ctx.outbox.count()).toBe(1)
    })

    it('stores a null ref when none is supplied', () => {
      ctx = tempRouter()
      const e = ctx.outbox.enqueue({ method: 'pair', input: {} })
      expect(e.ref).toBeNull()
    })

    it('rejects missing method', () => {
      ctx = tempRouter()
      expect(() => ctx.outbox.enqueue({ method: '', input: {} })).toThrow()
    })

    it('each enqueue yields a unique idempotency key', () => {
      ctx = tempRouter()
      const a = ctx.outbox.enqueue({ method: 'pod.rename', input: {} })
      const b = ctx.outbox.enqueue({ method: 'pod.rename', input: {} })
      expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    })
  })

  describe('idempotency-key format', () => {
    it('is version-prefixed and stable for the same clientId+entryId', () => {
      const a = makeIdempotencyKey('client-A', 'entry-1')
      const b = makeIdempotencyKey('client-A', 'entry-1')
      expect(a).toBe(b)
      expect(a.startsWith('v' + IDEMPOTENCY_VERSION + ':')).toBe(true)
    })

    it('differs when any component differs', () => {
      expect(makeIdempotencyKey('A', '1')).not.toBe(makeIdempotencyKey('B', '1'))
      expect(makeIdempotencyKey('A', '1')).not.toBe(makeIdempotencyKey('A', '2'))
      expect(makeIdempotencyKey('A', '1', '1')).not.toBe(makeIdempotencyKey('A', '1', '2'))
    })
  })

  describe('persistence across restart', () => {
    it('reloads entries on reopen', () => {
      ctx = tempRouter({ now: () => 100 })
      const e = ctx.outbox.enqueue({
        method: 'pod.rename',
        input: { name: 'x' },
        ref: podRef('srv-1', 'p1'),
      })
      ctx = reopen(ctx)
      const loaded = ctx.outbox.loadAll()
      expect(loaded).toHaveLength(1)
      expect(loaded[0]!.id).toBe(e.id)
      expect(loaded[0]!.method).toBe('pod.rename')
      expect(loaded[0]!.idempotencyKey).toBe(e.idempotencyKey)
      expect(loaded[0]!.ref?.kind).toBe('pod')
    })

    it('re-validates refs via Zod on load and reports invalid rows', () => {
      ctx = tempRouter()
      // Insert raw — bypass enqueue — so we can seed a malformed ref.
      const id = 'manual-id'
      const idempotencyKey = 'v1:fake'
      ctx.db
        .prepare(
          'INSERT INTO outbox (id, idempotency_key, method, input_json, ref_json, created_at, retries) VALUES (?, ?, ?, ?, ?, ?, 0)',
        )
        .run(id, idempotencyKey, 'pod.rename', '{}', '{"kind":"ghost","id":"x","serverId":"srv"}', 1000)
      const onInvalid = vi.fn()
      const all = ctx.outbox.loadAll(onInvalid)
      expect(all).toHaveLength(1)
      expect(all[0]!.ref).toBeNull()
      expect(onInvalid).toHaveBeenCalledTimes(1)
    })

    it('preserves retries / lastError across reload', () => {
      ctx = tempRouter()
      const e = ctx.outbox.enqueue({ method: 'pod.rename', input: {} })
      ctx.outbox.markRetry(e.id, 'ECONNRESET')
      ctx.outbox.markRetry(e.id, 'ECONNRESET')
      ctx = reopen(ctx)
      const loaded = ctx.outbox.loadAll()
      expect(loaded[0]!.retries).toBe(2)
      expect(loaded[0]!.lastError).toBe('ECONNRESET')
    })
  })

  describe('markRetry / remove', () => {
    it('increments retries and captures last error', () => {
      ctx = tempRouter()
      const e = ctx.outbox.enqueue({ method: 'pod.rename', input: {} })
      const r = ctx.outbox.markRetry(e.id, 'boom')
      expect(r.retries).toBe(1)
      expect(r.lastError).toBe('boom')
    })

    it('markRetry throws on unknown id', () => {
      ctx = tempRouter()
      expect(() => ctx.outbox.markRetry('ghost')).toThrow(OutboxEntryNotFoundError)
    })

    it('remove returns true only when the row existed', () => {
      ctx = tempRouter()
      const e = ctx.outbox.enqueue({ method: 'pod.rename', input: {} })
      expect(ctx.outbox.remove(e.id)).toBe(true)
      expect(ctx.outbox.remove(e.id)).toBe(false)
      expect(ctx.outbox.count()).toBe(0)
    })
  })

  describe('loadAll ordering', () => {
    it('returns rows in createdAt ascending order', () => {
      const times = [100, 50, 200]
      let i = 0
      ctx = tempRouter({ now: () => times[i++] ?? 0 })
      ctx.outbox.enqueue({ method: 'a', input: {}, ref: podRef('srv', 'a') })
      ctx.outbox.enqueue({ method: 'b', input: {}, ref: workspaceRef('srv', 'b') })
      ctx.outbox.enqueue({ method: 'c', input: {} })
      const loaded = ctx.outbox.loadAll()
      expect(loaded.map((r) => r.method)).toEqual(['b', 'a', 'c'])
    })
  })
})
