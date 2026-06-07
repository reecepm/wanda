import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventLogReadOnlyError, ReplayGoneError } from '../errors.ts'
import { makeClock, makeTempEventLog, type TempEventLog } from './helpers.ts'

describe('event-log publish + replay', () => {
  let ctx: TempEventLog

  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  describe('publish', () => {
    it('assigns strictly-monotonic seq starting at 1', () => {
      const seqs = [] as number[]
      for (let i = 0; i < 20; i++) {
        const rec = ctx.log.publish('event:pod:created', 'pod', `pod-${i}`, { i })
        seqs.push(rec.seq)
      }
      expect(seqs[0]).toBe(1)
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!)
      }
      expect(ctx.log.currentSeq()).toBe(seqs[seqs.length - 1])
    })

    it('persists the payload as JSON and reads it back equal', () => {
      const payload = { pod: { id: 'p1', nested: { arr: [1, 2, 3], nil: null } } }
      const rec = ctx.log.publish('event:pod:created', 'pod', 'p1', payload)
      expect(rec.payload).toEqual(payload)
      const page = ctx.log.replayAll(0, 1)
      expect(page.ok).toBe(true)
      if (page.ok) expect(page.events[0]!.payload).toEqual(payload)
    })

    it('rejects unknown channel', () => {
      // Cast is the only way to trigger the runtime guard — TS protects callers
      // at compile time, runtime is a defense-in-depth check.
      expect(() => ctx.log.publish('event:bogus:created' as never, 'pod', 'p1', {})).toThrow(/unknown channel/)
    })

    it('rejects unknown resource kind', () => {
      expect(() => ctx.log.publish('event:pod:created', 'ghost' as never, 'p1', {})).toThrow(/unknown resourceKind/)
    })

    it('rejects empty resourceId', () => {
      expect(() => ctx.log.publish('event:pod:created', 'pod', '', {})).toThrow(/non-empty/)
    })

    it('refuses to publish in read-only mode', () => {
      ctx.log.enterReadOnly('disk-full')
      expect(() => ctx.log.publish('event:pod:created', 'pod', 'p1', {})).toThrow(EventLogReadOnlyError)
    })
  })

  describe('replay', () => {
    it('returns empty on a fresh log', () => {
      const page = ctx.log.replayAll(0, 1)
      expect(page.ok).toBe(true)
      if (page.ok) {
        expect(page.events).toEqual([])
        expect(page.done).toBe(true)
      }
    })

    it('returns all events in seq order from sinceSeq=0', () => {
      for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })
      const result = ctx.log.replayAll(0, 1)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5])
        expect(result.done).toBe(true)
      }
    })

    it('returns only events after sinceSeq', () => {
      for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })
      const result = ctx.log.replayAll(3, 1)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.events.map((e) => e.seq)).toEqual([4, 5])
    })

    it('is idempotent — replaying the same range returns identical rows', () => {
      for (let i = 0; i < 10; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })
      const a = ctx.log.replayAll(0, 1)
      const b = ctx.log.replayAll(0, 1)
      expect(a.ok && b.ok).toBe(true)
      if (a.ok && b.ok) expect(a.events).toEqual(b.events)
    })

    it('paginates when limit < total', () => {
      for (let i = 0; i < 7; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })

      const p1 = ctx.log.replayPage(0, 1, 3)
      expect(p1.ok).toBe(true)
      if (!p1.ok) return
      expect(p1.events.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(p1.done).toBe(false)
      expect(p1.nextCursor).toBe(3)

      const p2 = ctx.log.replayPage(p1.nextCursor, 1, 3)
      expect(p2.ok).toBe(true)
      if (!p2.ok) return
      expect(p2.events.map((e) => e.seq)).toEqual([4, 5, 6])
      expect(p2.done).toBe(false)

      const p3 = ctx.log.replayPage(p2.nextCursor, 1, 3)
      expect(p3.ok).toBe(true)
      if (!p3.ok) return
      expect(p3.events.map((e) => e.seq)).toEqual([7])
      expect(p3.done).toBe(true)
    })

    it('replayAllOrThrow wraps ReplayGone in an exception', () => {
      ctx.log.publish('event:pod:created', 'pod', 'p1', {})
      expect(() => ctx.log.replayAllOrThrow(0, 99)).toThrow(ReplayGoneError)
    })
  })

  describe('epoch handling', () => {
    it('returns epoch-mismatch when sinceEpoch differs', () => {
      ctx.log.publish('event:pod:created', 'pod', 'p1', {})
      const result = ctx.log.replayAll(0, 99)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe('epoch-mismatch')
    })

    it('new epoch sees only events published after the bump', () => {
      ctx.log.publish('event:pod:created', 'pod', 'p-e1', {})
      ctx.log.setEpoch(2)
      // Old-epoch events are still in the DB but filtered out of new-epoch replay.
      const old = ctx.log.replayAll(0, 1)
      expect(old.ok).toBe(false) // old epoch != current epoch → epoch-mismatch
      if (!old.ok) expect(old.reason).toBe('epoch-mismatch')

      ctx.log.publish('event:pod:created', 'pod', 'p-e2', {})
      const fresh = ctx.log.replayAll(0, 2)
      expect(fresh.ok).toBe(true)
      if (fresh.ok) {
        expect(fresh.events).toHaveLength(1)
        expect(fresh.events[0]!.epoch).toBe(2)
        expect(fresh.events[0]!.resourceId).toBe('p-e2')
      }
    })

    it('fresh epoch with no events is replayable (not epoch-mismatch, not too-old)', () => {
      ctx.log.setEpoch(2)
      // Client reconnects after reboot with resumeFromSeq=17, epoch=2.
      // Server has zero events at epoch 2. This should return empty, not too-old.
      const result = ctx.log.replayAll(17, 2)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.events).toEqual([])
    })

    it('setEpoch rejects non-positive values', () => {
      expect(() => ctx.log.setEpoch(0)).toThrow(/positive integer/)
      expect(() => ctx.log.setEpoch(-1)).toThrow(/positive integer/)
      expect(() => ctx.log.setEpoch(1.5)).toThrow(/positive integer/)
    })
  })

  describe('property: publish → replayAll is order-preserving', () => {
    it('emits events in publish order for any sequence', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ id: fc.string({ minLength: 1, maxLength: 8 }) }), {
            minLength: 0,
            maxLength: 50,
          }),
          (items) => {
            const c = makeTempEventLog({ epoch: 1 })
            try {
              const ids = items.map((x) => x.id)
              for (const id of ids) c.log.publish('event:pod:created', 'pod', id, { id })
              const page = c.log.replayAll(0, 1)
              if (!page.ok) return false
              const replayedIds = page.events.map((e) => e.resourceId)
              return page.events.length === ids.length && ids.every((id, i) => id === replayedIds[i])
            } finally {
              c.cleanup()
            }
          },
        ),
        { numRuns: 40 }, // keep modest — each case touches disk
      )
    })
  })
})

describe('event-log clock', () => {
  it('uses the injected now() for ts values', () => {
    const clock = makeClock(1_700_000_000_000)
    const c = makeTempEventLog({ epoch: 1, now: clock.now })
    try {
      const a = c.log.publish('event:pod:created', 'pod', 'p1', {})
      expect(a.ts).toBe(1_700_000_000_000)
      clock.advance(5_000)
      const b = c.log.publish('event:pod:updated', 'pod', 'p1', {})
      expect(b.ts).toBe(1_700_000_005_000)
    } finally {
      c.cleanup()
    }
  })
})
