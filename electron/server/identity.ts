// -----------------------------------------------------------------------------
// Stable server identity.
//
// Replaces the per-boot `randomBytes(16)` that used to be regenerated every
// time the shell booted, stranding paired clients with a "new server" on
// every restart. The identity is persisted in the `settings` table so it
// survives restarts and app updates.
//
// Optional `epoch_crc` integrity seal uses `@wanda/session`'s `crc32Of` so
// a torn write on a disk-full event is detected instead of silently mutating
// client-visible identity.
// -----------------------------------------------------------------------------
//
// Schema (rows in the existing `settings` KV table, no migration needed):
//   server.id         — 32-char hex, stable forever for this install
//   server.id.epoch   — integer, bumps on every boot (detects missed reboots)
//   server.id.crc     — CRC32 of epoch, detects corruption
//
// If `server.id.crc` disagrees with `crc32Of(server.id.epoch)` on boot, the
// runtime refuses to start and the log points the operator at the remedy:
// clear those three rows (which forces all paired clients to re-pair).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import { crc32Of } from '@wanda/session'
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/connection'
import { settings } from '../db/schema'
import { log } from '../packages/logger'

const KEY_ID = 'server.id'
const KEY_EPOCH = 'server.id.epoch'
const KEY_CRC = 'server.id.crc'

export interface ServerIdentity {
  readonly id: string
  readonly epoch: number
}

export class ServerIdentityCorruptedError extends Error {
  constructor(storedEpoch: number, storedCrc: number, expectedCrc: number) {
    super(
      `server identity CRC mismatch: epoch=${storedEpoch}, stored crc=${storedCrc}, expected=${expectedCrc}. ` +
        `This indicates a torn write (e.g. disk-full). To recover, ` +
        `DELETE FROM settings WHERE key IN ('server.id', 'server.id.epoch', 'server.id.crc'); ` +
        `every paired client will need to re-pair.`,
    )
    this.name = 'ServerIdentityCorruptedError'
  }
}

/**
 * Load the server identity, creating it on first boot and bumping the epoch
 * on every subsequent boot. The id is stable for the lifetime of the install;
 * the epoch is what clients compare on reconnect to detect a server restart.
 */
export function getOrCreateServerIdentity(db: AppDatabase): ServerIdentity {
  // Env override still supported — required by the subprocess tests that set
  // WANDA_SERVER_ID explicitly.
  const override = process.env.WANDA_SERVER_ID
  if (override) {
    // Even with override, we persist the epoch so restart counters keep working.
    const prev = readSetting(db, KEY_EPOCH)
    const nextEpoch = prev ? Number(prev) + 1 : 1
    writeSetting(db, KEY_ID, override)
    writeSetting(db, KEY_EPOCH, String(nextEpoch))
    writeSetting(db, KEY_CRC, String(crc32Of(nextEpoch)))
    return { id: override, epoch: nextEpoch }
  }

  const existingId = readSetting(db, KEY_ID)
  const existingEpochStr = readSetting(db, KEY_EPOCH)
  const existingCrcStr = readSetting(db, KEY_CRC)

  if (existingId && existingEpochStr && existingCrcStr) {
    const storedEpoch = Number(existingEpochStr)
    const storedCrc = Number(existingCrcStr)
    if (!Number.isInteger(storedEpoch) || !Number.isInteger(storedCrc)) {
      throw new ServerIdentityCorruptedError(storedEpoch, storedCrc, NaN)
    }
    const expectedCrc = crc32Of(storedEpoch)
    if (expectedCrc !== storedCrc) {
      throw new ServerIdentityCorruptedError(storedEpoch, storedCrc, expectedCrc)
    }
    const nextEpoch = storedEpoch + 1
    writeSetting(db, KEY_EPOCH, String(nextEpoch))
    writeSetting(db, KEY_CRC, String(crc32Of(nextEpoch)))
    return { id: existingId, epoch: nextEpoch }
  }

  // Fresh install (or manually-reset identity) — mint a new id at epoch 1.
  const id = existingId ?? randomBytes(16).toString('hex')
  const epoch = 1
  writeSetting(db, KEY_ID, id)
  writeSetting(db, KEY_EPOCH, String(epoch))
  writeSetting(db, KEY_CRC, String(crc32Of(epoch)))
  log.main.info(`server identity initialized: id=${id} epoch=${epoch}`)
  return { id, epoch }
}

function readSetting(db: AppDatabase, key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  return row?.value ?? null
}

function writeSetting(db: AppDatabase, key: string, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run()
}
