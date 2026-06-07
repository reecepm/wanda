import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeClock, makeTempEventLog, type TempEventLog } from './helpers.ts'

describe('event-log pruner', () => {
  let ctx: TempEventLog

  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  it('prune(maxRows) trims oldest rows to a cap', () => {
    for (let i = 0; i < 10; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })
    const removed = ctx.log.prune({ maxRows: 4 })
    expect(removed).toBe(6)
    expect(ctx.log.rowCount()).toBe(4)
    // Client caught up past the pruner sees the remaining rows.
    const page = ctx.log.replayAll(6, 1)
    expect(page.ok).toBe(true)
    if (page.ok) expect(page.events.map((e) => e.seq)).toEqual([7, 8, 9, 10])
    // A client from sinceSeq=0 (behind the pruner) is correctly flagged too-old.
    const stale = ctx.log.replayAll(0, 1)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('too-old')
  })

  it('prune(maxAgeMs) drops rows older than the cutoff', () => {
    const clock = makeClock(1_000_000)
    const c = makeTempEventLog({ epoch: 1, now: clock.now })
    try {
      c.log.publish('event:pod:created', 'pod', 'old-1', {})
      c.log.publish('event:pod:created', 'pod', 'old-2', {})
      clock.advance(60_000) // 60s pass
      c.log.publish('event:pod:created', 'pod', 'fresh-1', {})
      c.log.publish('event:pod:created', 'pod', 'fresh-2', {})

      const removed = c.log.prune({ maxAgeMs: 30_000 })
      expect(removed).toBe(2)
      expect(c.log.rowCount()).toBe(2)
      // Client that was up-to-date pre-prune (sinceSeq=2) sees the kept rows.
      const page = c.log.replayAll(2, 1)
      expect(page.ok).toBe(true)
      if (page.ok) expect(page.events.map((e) => e.resourceId)).toEqual(['fresh-1', 'fresh-2'])
    } finally {
      c.cleanup()
    }
  })

  it('prune(maxAgeMs + maxRows) applies both rules additively', () => {
    const clock = makeClock(1_000_000)
    const c = makeTempEventLog({ epoch: 1, now: clock.now })
    try {
      // 3 old, then 5 fresh
      for (let i = 0; i < 3; i++) c.log.publish('event:pod:created', 'pod', `old-${i}`, {})
      clock.advance(60_000)
      for (let i = 0; i < 5; i++) c.log.publish('event:pod:created', 'pod', `fresh-${i}`, {})

      // 30s cutoff removes 3 old. Then maxRows=2 trims 3 more → total 6 removed, 2 left.
      const removed = c.log.prune({ maxAgeMs: 30_000, maxRows: 2 })
      expect(removed).toBe(6)
      expect(c.log.rowCount()).toBe(2)
      // Caught-up client (sinceSeq=6) sees the kept rows.
      const page = c.log.replayAll(6, 1)
      expect(page.ok).toBe(true)
      if (page.ok) expect(page.events.map((e) => e.resourceId)).toEqual(['fresh-3', 'fresh-4'])
    } finally {
      c.cleanup()
    }
  })

  it('replay from a pruned seq returns too-old', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, {})
    // Remember first seq before pruning
    const firstPage = ctx.log.replayPage(0, 1)
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) return
    const firstSeq = firstPage.events[0]!.seq

    ctx.log.prune({ maxRows: 2 })
    // Now only seq 4, 5 remain. Client with sinceSeq=0 is 3 events behind.
    const stale = ctx.log.replayAll(firstSeq - 1, 1)
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('too-old')
  })

  it('client sinceSeq exactly at oldest - 1 is NOT too-old', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, {})
    ctx.log.prune({ maxRows: 2 })
    // Remaining rows: seq 4, 5 (oldest = 4). Client with sinceSeq=3 wants
    // events > 3, i.e. [4, 5]. oldest(4) ≤ 3+1, so replay proceeds.
    const page = ctx.log.replayAll(3, 1)
    expect(page.ok).toBe(true)
    if (page.ok) expect(page.events.map((e) => e.seq)).toEqual([4, 5])
  })

  it('pruner during an interleaved publish sequence keeps the log consistent', () => {
    // Simulate the race: publish a burst, prune, publish another burst, replay.
    for (let i = 0; i < 20; i++) ctx.log.publish('event:pod:created', 'pod', `a-${i}`, {})
    ctx.log.prune({ maxRows: 10 }) // keep latest 10 (seq 11..20)
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `b-${i}`, {})

    expect(ctx.log.rowCount()).toBe(15)
    expect(ctx.log.currentSeq()).toBe(25) // AUTOINCREMENT does not reuse seqs

    const page = ctx.log.replayAll(10, 1)
    expect(page.ok).toBe(true)
    if (page.ok) {
      expect(page.events.map((e) => e.seq)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
    }
  })

  it('prunes to zero rows and still flags stale clients as too-old', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, {})
    ctx.log.prune({ maxRows: 0 })
    expect(ctx.log.rowCount()).toBe(0)
    // Everything pruned; a client that had seen up to seq=3 is too-old.
    const result = ctx.log.replayAll(3, 1)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too-old')
  })

  it('rejects invalid prune options', () => {
    expect(() => ctx.log.prune({ maxAgeMs: -1 })).toThrow()
    expect(() => ctx.log.prune({ maxRows: -1 })).toThrow()
    expect(() => ctx.log.prune({ maxRows: 1.5 })).toThrow()
  })
})
