// -----------------------------------------------------------------------------
// Coverage for the per-resource API additions:
//   - replayPageByResource (forward / backward / upToSeq / paging)
//   - deleteByResource
//   - publishBatch
//   - bytesForResource
//   - prune({ resourceKind })
// -----------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeClock, makeTempEventLog, type TempEventLog } from './helpers.ts'

describe('replayPageByResource', () => {
  let ctx: TempEventLog
  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  it('returns only rows for the requested (kind, id)', () => {
    ctx.log.publish('event:pod:created', 'pod', 'pA', { name: 'A' })
    ctx.log.publish('event:pod:created', 'pod', 'pB', { name: 'B' })
    ctx.log.publish('event:pod:updated', 'pod', 'pA', { name: 'A2' })

    const page = ctx.log.replayPageByResource('pod', 'pA', { sinceSeq: 0, sinceEpoch: 1 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.events).toHaveLength(2)
    expect(page.events.every((e) => e.resourceId === 'pA')).toBe(true)
  })

  it('forward direction returns events in ascending seq', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', 'pA', { i })
    const page = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: 0,
      sinceEpoch: 1,
      direction: 'forward',
    })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const seqs = page.events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
  })

  it('backward direction returns events in descending seq and requires upToSeq', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', 'pA', { i })
    const tip = ctx.log.currentSeq()
    const page = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: 0,
      sinceEpoch: 1,
      upToSeq: tip + 1,
      direction: 'backward',
    })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const seqs = page.events.map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a))

    expect(() =>
      ctx.log.replayPageByResource('pod', 'pA', {
        sinceSeq: 0,
        sinceEpoch: 1,
        direction: 'backward',
      }),
    ).toThrow(/upToSeq/)
  })

  it('respects upToSeq as an exclusive upper bound (forward)', () => {
    const seqs: number[] = []
    for (let i = 0; i < 5; i++) {
      const rec = ctx.log.publish('event:pod:created', 'pod', 'pA', { i })
      seqs.push(rec.seq)
    }
    const cap = seqs[2]!
    const page = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: 0,
      sinceEpoch: 1,
      upToSeq: cap,
    })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.events.map((e) => e.seq)).toEqual([seqs[0], seqs[1], seqs[2]])
  })

  it('paginates with limit and reports done=false when more remain', () => {
    for (let i = 0; i < 7; i++) ctx.log.publish('event:pod:created', 'pod', 'pA', { i })
    const page = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: 0,
      sinceEpoch: 1,
      limit: 3,
    })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.events).toHaveLength(3)
    expect(page.done).toBe(false)

    const page2 = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: page.nextCursor,
      sinceEpoch: 1,
      limit: 3,
    })
    expect(page2.ok).toBe(true)
    if (!page2.ok) return
    expect(page2.events).toHaveLength(3)
    expect(page2.done).toBe(false)

    const page3 = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: page2.nextCursor,
      sinceEpoch: 1,
      limit: 3,
    })
    expect(page3.ok).toBe(true)
    if (!page3.ok) return
    expect(page3.events).toHaveLength(1)
    expect(page3.done).toBe(true)
  })

  it('returns epoch-mismatch when sinceEpoch differs', () => {
    ctx.log.publish('event:pod:created', 'pod', 'pA', {})
    const page = ctx.log.replayPageByResource('pod', 'pA', { sinceSeq: 0, sinceEpoch: 99 })
    expect(page.ok).toBe(false)
    if (page.ok) return
    expect(page.reason).toBe('epoch-mismatch')
  })

  it('can replay one resource across epochs for cold transcript loads', () => {
    const first = ctx.log.publish('event:pod:created', 'pod', 'pA', { name: 'old' })
    ctx.log.publish('event:pod:created', 'pod', 'pB', { name: 'other' })
    ctx.log.setEpoch(2)
    const second = ctx.log.publish('event:pod:updated', 'pod', 'pA', { name: 'new' })

    const epochScoped = ctx.log.replayPageByResource('pod', 'pA', {
      sinceSeq: 0,
      sinceEpoch: 2,
    })
    expect(epochScoped.ok).toBe(true)
    if (!epochScoped.ok) return
    expect(epochScoped.events.map((e) => e.seq)).toEqual([second.seq])

    const allEpochs = ctx.log.replayPageByResourceAllEpochs('pod', 'pA', {
      sinceSeq: 0,
    })
    expect(allEpochs.ok).toBe(true)
    if (!allEpochs.ok) return
    expect(allEpochs.events.map((e) => e.seq)).toEqual([first.seq, second.seq])
  })

  it('returns empty (not too-old) for a fresh epoch with no rows', () => {
    const page = ctx.log.replayPageByResource('pod', 'pA', { sinceSeq: 0, sinceEpoch: 1 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.events).toHaveLength(0)
    expect(page.done).toBe(true)
    expect(page.nextCursor).toBe(0)
  })

  it('rejects unknown resource kinds', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid
      ctx.log.replayPageByResource('nope', 'x', { sinceSeq: 0, sinceEpoch: 1 }),
    ).toThrow(/unknown resourceKind/)
  })
})

describe('deleteByResource', () => {
  let ctx: TempEventLog
  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  it('deletes only rows for the given (kind, id) and returns the seq range', () => {
    const a1 = ctx.log.publish('event:pod:created', 'pod', 'pA', {})
    ctx.log.publish('event:pod:created', 'pod', 'pB', {})
    const a2 = ctx.log.publish('event:pod:updated', 'pod', 'pA', {})

    const result = ctx.log.deleteByResource('pod', 'pA')
    expect(result.rowsDeleted).toBe(2)
    expect(result.minSeq).toBe(a1.seq)
    expect(result.maxSeq).toBe(a2.seq)

    const page = ctx.log.replayPageByResource('pod', 'pA', { sinceSeq: 0, sinceEpoch: 1 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    expect(page.events).toHaveLength(0)

    const other = ctx.log.replayPageByResource('pod', 'pB', { sinceSeq: 0, sinceEpoch: 1 })
    expect(other.ok).toBe(true)
    if (!other.ok) return
    expect(other.events).toHaveLength(1)
  })

  it('is a no-op for a resource with no rows', () => {
    const result = ctx.log.deleteByResource('pod', 'doesNotExist')
    expect(result).toEqual({ rowsDeleted: 0, minSeq: null, maxSeq: null })
  })
})

describe('publishBatch', () => {
  let ctx: TempEventLog
  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  it('inserts rows atomically in order with monotonically increasing seqs', () => {
    const records = ctx.log.publishBatch([
      { channel: 'event:pod:created', resourceKind: 'pod', resourceId: 'pA', payload: { i: 0 } },
      { channel: 'event:pod:updated', resourceKind: 'pod', resourceId: 'pA', payload: { i: 1 } },
      { channel: 'event:pod:updated', resourceKind: 'pod', resourceId: 'pA', payload: { i: 2 } },
    ])
    expect(records).toHaveLength(3)
    const seqs = records.map((r) => r.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))

    const replay = ctx.log.replayPageByResource('pod', 'pA', { sinceSeq: 0, sinceEpoch: 1 })
    expect(replay.ok).toBe(true)
    if (!replay.ok) return
    expect(replay.events.map((e) => (e.payload as { i: number }).i)).toEqual([0, 1, 2])
  })

  it('returns [] for empty input', () => {
    expect(ctx.log.publishBatch([])).toEqual([])
  })

  it('rejects unknown channels without committing any row', () => {
    const before = ctx.log.currentSeq()
    expect(() =>
      ctx.log.publishBatch([
        { channel: 'event:pod:created', resourceKind: 'pod', resourceId: 'pA', payload: {} },
        // @ts-expect-error deliberately invalid
        { channel: 'event:bogus:x', resourceKind: 'pod', resourceId: 'pA', payload: {} },
      ]),
    ).toThrow(/unknown channel/)
    expect(ctx.log.currentSeq()).toBe(before)
  })
})

describe('bytesForResource', () => {
  let ctx: TempEventLog
  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  it('reports 0 for an unknown resource id', () => {
    expect(ctx.log.bytesForResource('pod', 'nothing')).toBe(0)
  })

  it('sums payload byte lengths for the given (kind, id)', () => {
    ctx.log.publish('event:pod:created', 'pod', 'pA', { x: 'y' })
    ctx.log.publish('event:pod:updated', 'pod', 'pA', { big: 'a'.repeat(100) })
    ctx.log.publish('event:pod:created', 'pod', 'pB', { x: 'unrelated' })

    const bytes = ctx.log.bytesForResource('pod', 'pA')
    // payload_json total for pA = JSON.stringify({x:'y'}) + JSON.stringify({big: 'a'×100})
    const expected = JSON.stringify({ x: 'y' }).length + JSON.stringify({ big: 'a'.repeat(100) }).length
    expect(bytes).toBe(expected)
  })
})

describe('prune({ resourceKind })', () => {
  let ctx: TempEventLog
  let clock: ReturnType<typeof makeClock>
  beforeEach(() => {
    clock = makeClock(1_700_000_000_000)
    ctx = makeTempEventLog({ epoch: 1, now: clock.now })
  })
  afterEach(() => ctx.cleanup())

  it('prunes only the requested kind when scoped', () => {
    for (let i = 0; i < 5; i++) ctx.log.publish('event:pod:created', 'pod', `p${i}`, { i })
    for (let i = 0; i < 5; i++) ctx.log.publish('event:workspace:created', 'workspace', `w${i}`, { i })

    const before = ctx.log.rowCount()
    const removed = ctx.log.prune({ resourceKind: 'pod', maxRows: 2 })
    expect(removed).toBe(3)
    expect(ctx.log.rowCount()).toBe(before - 3)

    // workspace rows untouched
    const wpage = ctx.log.replayPageByResource('workspace', 'w0', { sinceSeq: 0, sinceEpoch: 1 })
    expect(wpage.ok).toBe(true)
    if (!wpage.ok) return
    expect(wpage.events).toHaveLength(1)
  })

  it('age-based scoping leaves other kinds alone', () => {
    ctx.log.publish('event:pod:created', 'pod', 'pA', {})
    ctx.log.publish('event:workspace:created', 'workspace', 'wA', {})
    clock.advance(10_000)
    ctx.log.publish('event:pod:updated', 'pod', 'pA', {})

    // cut rows older than 1s → only the two earliest rows qualify, but scoped
    // to pod, only the pod row goes.
    const removed = ctx.log.prune({ resourceKind: 'pod', maxAgeMs: 1000 })
    expect(removed).toBe(1)
    const workspacePage = ctx.log.replayPageByResource('workspace', 'wA', {
      sinceSeq: 0,
      sinceEpoch: 1,
    })
    expect(workspacePage.ok).toBe(true)
    if (!workspacePage.ok) return
    expect(workspacePage.events).toHaveLength(1)
  })

  it('rejects unknown resourceKind at the boundary', () => {
    expect(() =>
      // @ts-expect-error deliberately invalid
      ctx.log.prune({ resourceKind: 'nope', maxRows: 1 }),
    ).toThrow(/unknown resourceKind/)
  })
})
