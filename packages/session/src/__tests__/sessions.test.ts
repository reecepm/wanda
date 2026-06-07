import { afterEach, describe, expect, it } from 'vitest'
import { SessionExpiredError, SessionNotFoundError } from '../errors.ts'
import {
  makeClock,
  makeSeededRandom,
  makeTempSessionStore,
  reopenSessionStore,
  type TempSessionStore,
} from './helpers.ts'

describe('session lifecycle', () => {
  let ctx: TempSessionStore
  afterEach(() => ctx?.cleanup())

  it('creates a session with all expected fields', () => {
    const clock = makeClock(1_700_000_000_000)
    ctx = makeTempSessionStore({ now: clock.now })
    const s = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'MBP 16"' })
    expect(s.clientId).toBe('client-A')
    expect(s.deviceLabel).toBe('MBP 16"')
    expect(s.sessionId.length).toBeGreaterThan(0)
    expect(s.sessionToken.length).toBeGreaterThan(0)
    expect(s.createdAt).toBe(1_700_000_000_000)
    expect(s.expiresAt - s.createdAt).toBe(30 * 24 * 60 * 60 * 1000)
    expect(s.lastSeenAt).toBe(s.createdAt)
  })

  it('rejects invalid inputs', () => {
    ctx = makeTempSessionStore()
    expect(() => ctx.store.createSession({ clientId: '', deviceLabel: 'x' })).toThrow()
    expect(() => ctx.store.createSession({ clientId: 'c', deviceLabel: '' })).toThrow()
  })

  it('enforces one session per clientId — second createSession replaces the first', () => {
    ctx = makeTempSessionStore()
    const a = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'laptop' })
    const b = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'laptop-again' })
    expect(b.sessionId).not.toBe(a.sessionId)
    expect(b.sessionToken).not.toBe(a.sessionToken)
    expect(ctx.store.findById(a.sessionId)).toBeNull()
    expect(ctx.store.findById(b.sessionId)).not.toBeNull()
    expect(ctx.store.list()).toHaveLength(1)
  })

  it('finds by id / token / clientId', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'laptop' })
    expect(ctx.store.findById(s.sessionId)!.sessionId).toBe(s.sessionId)
    expect(ctx.store.findByToken(s.sessionToken)!.sessionId).toBe(s.sessionId)
    expect(ctx.store.findByClientId(s.clientId)!.sessionId).toBe(s.sessionId)
    expect(ctx.store.findById('unknown')).toBeNull()
    expect(ctx.store.findByToken('unknown')).toBeNull()
    expect(ctx.store.findByClientId('unknown')).toBeNull()
  })

  it('touch updates last_seen_at', () => {
    const clock = makeClock(1000)
    ctx = makeTempSessionStore({ now: clock.now })
    const s = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'x' })
    clock.advance(5000)
    ctx.store.touch(s.sessionId)
    expect(ctx.store.findById(s.sessionId)!.lastSeenAt).toBe(6000)
  })

  it('touch on unknown sessionId throws SessionNotFoundError', () => {
    ctx = makeTempSessionStore()
    expect(() => ctx.store.touch('unknown')).toThrow(SessionNotFoundError)
  })

  it('revoke deletes the row and returns true', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'x' })
    expect(ctx.store.revoke(s.sessionId)).toBe(true)
    expect(ctx.store.findById(s.sessionId)).toBeNull()
    // Re-revoking returns false.
    expect(ctx.store.revoke(s.sessionId)).toBe(false)
  })

  it('persists sessions across restart', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'client-A', deviceLabel: 'x' })
    ctx = reopenSessionStore(ctx)
    const reloaded = ctx.store.findByToken(s.sessionToken)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.sessionId).toBe(s.sessionId)
  })

  it('purgeExpired removes sessions past their expiry', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, sessionLifetimeMs: 60_000 })
    const s1 = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    clock.advance(30_000)
    const s2 = ctx.store.createSession({ clientId: 'B', deviceLabel: 'y' })

    clock.advance(40_000) // s1 now expired (70s past birth); s2 at 40s, not yet.
    const removed = ctx.store.purgeExpired()
    expect(removed).toBe(1)
    expect(ctx.store.findById(s1.sessionId)).toBeNull()
    expect(ctx.store.findById(s2.sessionId)).not.toBeNull()
  })

  describe('authenticateBearer', () => {
    it('returns the session on a live token', () => {
      ctx = makeTempSessionStore()
      const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
      expect(ctx.store.authenticateBearer(s.sessionToken).sessionId).toBe(s.sessionId)
    })

    it('throws SessionNotFoundError for an unknown token', () => {
      ctx = makeTempSessionStore()
      expect(() => ctx.store.authenticateBearer('garbage')).toThrow(SessionNotFoundError)
    })

    it('throws SessionExpiredError and purges when past expiry', () => {
      const clock = makeClock(1_000_000)
      ctx = makeTempSessionStore({ now: clock.now, sessionLifetimeMs: 1_000 })
      const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
      clock.advance(10_000)
      expect(() => ctx.store.authenticateBearer(s.sessionToken)).toThrow(SessionExpiredError)
      // Expired session is auto-removed.
      expect(ctx.store.findByToken(s.sessionToken)).toBeNull()
    })
  })

  describe('token uniqueness', () => {
    it('produces distinct sessionTokens even under a seeded random', () => {
      const rand = makeSeededRandom()
      ctx = makeTempSessionStore({ randomBytes: rand })
      const a = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
      const b = ctx.store.createSession({ clientId: 'B', deviceLabel: 'y' })
      expect(a.sessionToken).not.toBe(b.sessionToken)
      expect(a.sessionId).not.toBe(b.sessionId)
    })
  })
})
