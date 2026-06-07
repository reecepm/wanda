import { afterEach, describe, expect, it } from 'vitest'
import { makeClock, makeTempSessionStore, type TempSessionStore } from './helpers.ts'

describe('grace window', () => {
  let ctx: TempSessionStore
  afterEach(() => ctx?.cleanup())

  it('returns false for a client that never connected', () => {
    ctx = makeTempSessionStore()
    expect(ctx.store.isWithinGrace('never')).toBe(false)
  })

  it('stays within grace if reconnect is faster than the window', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, graceWindowMs: 10_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    ctx.store.markDisconnected(s.sessionId)
    clock.advance(5_000)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(true)
  })

  it('exits grace once the window elapses', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, graceWindowMs: 10_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    ctx.store.markDisconnected(s.sessionId)
    clock.advance(10_001)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(false)
    // And the entry is cleaned up — a second check doesn't reset the clock.
    clock.advance(-9_000)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(false)
  })

  it('clearGrace removes the entry so future disconnects start a fresh window', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, graceWindowMs: 10_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    ctx.store.markDisconnected(s.sessionId)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(true)
    ctx.store.clearGrace(s.clientId)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(false)

    // A new disconnect should start fresh — even if clock advances past the
    // original window, the new window should count from the new disconnect.
    clock.advance(15_000)
    ctx.store.markDisconnected(s.sessionId)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(true)
  })

  it('markDisconnected with an unknown sessionId is a no-op', () => {
    ctx = makeTempSessionStore()
    expect(() => ctx.store.markDisconnected('unknown')).not.toThrow()
  })

  it('revoke cleans up grace tracking for the client', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    ctx.store.markDisconnected(s.sessionId)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(true)
    ctx.store.revoke(s.sessionId)
    expect(ctx.store.isWithinGrace(s.clientId)).toBe(false)
  })

  it('multiple clients are tracked independently', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, graceWindowMs: 10_000 })
    const a = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const b = ctx.store.createSession({ clientId: 'B', deviceLabel: 'y' })
    ctx.store.markDisconnected(a.sessionId)
    clock.advance(6_000)
    ctx.store.markDisconnected(b.sessionId)
    clock.advance(5_000) // A: 11s total (expired). B: 5s (live).
    expect(ctx.store.isWithinGrace(a.clientId)).toBe(false)
    expect(ctx.store.isWithinGrace(b.clientId)).toBe(true)
  })
})
