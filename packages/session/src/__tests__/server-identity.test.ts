import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { crc32Of } from '../crc.ts'
import { ServerIdentityCorruptedError } from '../errors.ts'
import { SessionStore } from '../session-store.ts'
import { makeTempSessionStore, reopenSessionStore, type TempSessionStore } from './helpers.ts'

describe('server identity', () => {
  let ctx: TempSessionStore
  afterEach(() => ctx?.cleanup())

  it('creates a fresh identity on first boot with epoch=1', () => {
    ctx = makeTempSessionStore()
    const id = ctx.store.identity()
    expect(id.id).toMatch(/^[a-f0-9]{32}$/)
    expect(id.epoch).toBe(1)
    expect(id.createdAt).toBeGreaterThan(0)
  })

  it('persists the same id across restarts but bumps epoch', () => {
    ctx = makeTempSessionStore()
    const first = ctx.store.identity()

    const ctx2 = reopenSessionStore(ctx)
    ctx = ctx2
    const second = ctx.store.identity()

    expect(second.id).toBe(first.id)
    expect(second.epoch).toBe(2)
    expect(second.createdAt).toBe(first.createdAt)
  })

  it('bumps the epoch monotonically across multiple restarts', () => {
    ctx = makeTempSessionStore()
    const e1 = ctx.store.identity().epoch
    for (let i = 0; i < 3; i++) {
      ctx = reopenSessionStore(ctx)
    }
    const eFinal = ctx.store.identity().epoch
    expect(eFinal).toBe(e1 + 3)
  })

  it('rejects a row whose epoch_crc is wrong', () => {
    ctx = makeTempSessionStore()
    const id = ctx.store.identity().id
    ctx.store.close()

    // Corrupt the stored CRC.
    const db = new Database(ctx.dbPath)
    db.prepare('UPDATE server_identity SET epoch_crc = ? WHERE id = ?').run(0xdeadbeef, id)
    db.close()

    // Re-open: boot should throw.
    const reopen = () => new SessionStore(new Database(ctx.dbPath), { ownsDb: true })
    expect(reopen).toThrow(ServerIdentityCorruptedError)
  })

  it('crc32Of is stable and differs per value', () => {
    expect(crc32Of(1)).toBe(crc32Of(1))
    expect(crc32Of(1)).not.toBe(crc32Of(2))
    expect(crc32Of(2 ** 31)).toBe(crc32Of(2 ** 31))
  })

  it('resetIdentity issues a new id', () => {
    ctx = makeTempSessionStore()
    const before = ctx.store.identity().id
    ctx.store.resetIdentity()
    const after = ctx.store.identity().id
    expect(after).not.toBe(before)
  })

  it('round-trips CRC: stored value survives a reopen and revalidates', () => {
    ctx = makeTempSessionStore()
    // The constructor-time bump writes crc32Of(epoch+1). The reopen path
    // reads that stored pair and validates it. Any disagreement throws.
    for (let i = 0; i < 5; i++) {
      ctx = reopenSessionStore(ctx)
      const id = ctx.store.identity()
      expect(crc32Of(id.epoch)).toBeTypeOf('number')
    }
  })
})
