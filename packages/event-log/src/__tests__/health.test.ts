import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventLogClosedError, EventLogReadOnlyError, isDiskFullError } from '../errors.ts'
import { makeTempEventLog, type TempEventLog } from './helpers.ts'

describe('event-log health + lifecycle', () => {
  let ctx: TempEventLog

  beforeEach(() => {
    ctx = makeTempEventLog({ epoch: 1 })
  })
  afterEach(() => ctx.cleanup())

  describe('health', () => {
    it('starts healthy', () => {
      expect(ctx.log.health()).toEqual({ status: 'healthy' })
    })

    it('enters degraded on enterReadOnly', () => {
      ctx.log.enterReadOnly('disk-full')
      expect(ctx.log.health()).toEqual({ status: 'degraded', cause: 'disk-full' })
    })

    it('exits back to healthy', () => {
      ctx.log.enterReadOnly('disk-full')
      ctx.log.exitReadOnly()
      expect(ctx.log.health()).toEqual({ status: 'healthy' })
    })

    it('fires health listeners on transitions', () => {
      const seen: Array<{ status: string; cause?: string }> = []
      const unsub = ctx.log.onHealthChange((h) => seen.push({ ...h }))
      ctx.log.enterReadOnly('disk-full')
      ctx.log.exitReadOnly()
      unsub()
      ctx.log.enterReadOnly('disk-full') // should NOT fire
      expect(seen).toEqual([{ status: 'degraded', cause: 'disk-full' }, { status: 'healthy' }])
    })

    it('isolates a throwing listener — others still fire', () => {
      const good = vi.fn()
      const boom = vi.fn(() => {
        throw new Error('listener boom')
      })
      ctx.log.onHealthChange(boom)
      ctx.log.onHealthChange(good)
      // Silence expected console.error from the guarded listener.
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ctx.log.enterReadOnly('disk-full')
      spy.mockRestore()
      expect(boom).toHaveBeenCalled()
      expect(good).toHaveBeenCalled()
    })

    it('is idempotent — enterReadOnly twice fires once', () => {
      const fn = vi.fn()
      ctx.log.onHealthChange(fn)
      ctx.log.enterReadOnly('x')
      ctx.log.enterReadOnly('x')
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe('close', () => {
    it('rejects operations after close', () => {
      ctx.log.close()
      expect(() => ctx.log.publish('event:pod:created', 'pod', 'p1', {})).toThrow(EventLogClosedError)
      expect(() => ctx.log.replayPage(0, 1)).toThrow(EventLogClosedError)
      expect(() => ctx.log.currentSeq()).toThrow(EventLogClosedError)
    })

    it('is idempotent', () => {
      ctx.log.close()
      expect(() => ctx.log.close()).not.toThrow()
    })
  })

  describe('isDiskFullError', () => {
    it('matches SQLITE_FULL code', () => {
      expect(isDiskFullError({ code: 'SQLITE_FULL' })).toBe(true)
      expect(isDiskFullError({ code: 'SQLITE_IOERR_WRITE' })).toBe(true)
    })
    it('rejects unrelated errors', () => {
      expect(isDiskFullError({ code: 'SQLITE_BUSY' })).toBe(false)
      expect(isDiskFullError(new Error('boom'))).toBe(false)
      expect(isDiskFullError(null)).toBe(false)
      expect(isDiskFullError(undefined)).toBe(false)
      expect(isDiskFullError('SQLITE_FULL')).toBe(false)
    })
  })

  it('read-only mode throws EventLogReadOnlyError on publish', () => {
    ctx.log.enterReadOnly('disk-full')
    let err: unknown
    try {
      ctx.log.publish('event:pod:created', 'pod', 'p1', {})
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(EventLogReadOnlyError)
    if (err instanceof EventLogReadOnlyError) {
      expect(err.cause).toBe('disk-full')
    }
  })

  it('read-only mode throws on prune too', () => {
    ctx.log.publish('event:pod:created', 'pod', 'p1', {})
    ctx.log.enterReadOnly('disk-full')
    expect(() => ctx.log.prune({ maxRows: 0 })).toThrow(EventLogReadOnlyError)
  })
})
