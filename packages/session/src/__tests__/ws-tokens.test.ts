import { afterEach, describe, expect, it } from 'vitest'
import { SessionExpiredError, SessionNotFoundError } from '../errors.ts'
import { makeClock, makeTempSessionStore, type TempSessionStore } from './helpers.ts'

describe('wsToken lifecycle', () => {
  let ctx: TempSessionStore
  afterEach(() => ctx?.cleanup())

  it('issues a wsToken for a live session', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const grant = ctx.store.issueWsToken(s.sessionId)
    expect(grant.wsToken.length).toBeGreaterThan(0)
    expect(grant.expiresAt - 1_000_000).toBe(30_000)
  })

  it('consumes the token once — second use returns already-consumed', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const grant = ctx.store.issueWsToken(s.sessionId)

    const first = ctx.store.consumeWsToken(grant.wsToken)
    expect(first.ok).toBe(true)
    if (first.ok) {
      expect(first.sessionId).toBe(s.sessionId)
      expect(first.clientId).toBe(s.clientId)
    }

    const second = ctx.store.consumeWsToken(grant.wsToken)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('not-found')
  })

  it('rejects expired wsTokens', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, wsTokenLifetimeMs: 5_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const grant = ctx.store.issueWsToken(s.sessionId)

    clock.advance(10_000)
    const result = ctx.store.consumeWsToken(grant.wsToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('rejects unknown tokens', () => {
    ctx = makeTempSessionStore()
    const result = ctx.store.consumeWsToken('never-issued')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not-found')
  })

  it('rejects tokens whose underlying session was revoked', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const grant = ctx.store.issueWsToken(s.sessionId)
    ctx.store.revoke(s.sessionId)
    const result = ctx.store.consumeWsToken(grant.wsToken)
    expect(result.ok).toBe(false)
  })

  it('issueWsToken rejects unknown sessionId', () => {
    ctx = makeTempSessionStore()
    expect(() => ctx.store.issueWsToken('unknown')).toThrow(SessionNotFoundError)
  })

  it('issueWsToken rejects expired session', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, sessionLifetimeMs: 1_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    clock.advance(5_000)
    expect(() => ctx.store.issueWsToken(s.sessionId)).toThrow(SessionExpiredError)
  })

  it('revoking a session also invalidates its issued wsTokens', () => {
    ctx = makeTempSessionStore()
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    const g1 = ctx.store.issueWsToken(s.sessionId)
    const g2 = ctx.store.issueWsToken(s.sessionId)
    ctx.store.revoke(s.sessionId)
    expect(ctx.store.consumeWsToken(g1.wsToken).ok).toBe(false)
    expect(ctx.store.consumeWsToken(g2.wsToken).ok).toBe(false)
  })

  it('purgeExpiredWsTokens drops stale entries', () => {
    const clock = makeClock(1_000_000)
    ctx = makeTempSessionStore({ now: clock.now, wsTokenLifetimeMs: 5_000 })
    const s = ctx.store.createSession({ clientId: 'A', deviceLabel: 'x' })
    ctx.store.issueWsToken(s.sessionId)
    ctx.store.issueWsToken(s.sessionId)
    ctx.store.issueWsToken(s.sessionId)
    clock.advance(10_000)
    expect(ctx.store.purgeExpiredWsTokens()).toBe(3)
  })
})
