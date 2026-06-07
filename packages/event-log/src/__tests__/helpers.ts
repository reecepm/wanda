// -----------------------------------------------------------------------------
// Shared test helpers for @wanda/event-log. Will migrate to @wanda/test-utils
// (spec §14.3) once a second package needs the same fixtures.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { EventLog, type EventLogOptions } from '../event-log.ts'

export interface TempEventLog {
  readonly log: EventLog
  readonly dbPath: string
  readonly cleanup: () => void
}

/**
 * Create an on-disk EventLog in a fresh temp directory. On-disk (not
 * `:memory:`) so WAL and BEGIN IMMEDIATE semantics match production.
 */
export function makeTempEventLog(opts?: Partial<EventLogOptions>): TempEventLog {
  const dir = mkdtempSync(join(tmpdir(), 'wanda-event-log-test-'))
  const dbPath = join(dir, 'events.db')
  const db = new Database(dbPath)
  const log = new EventLog(db, {
    epoch: opts?.epoch ?? 1,
    migrationsDir: opts?.migrationsDir,
    now: opts?.now,
    ownsDb: true,
  })
  return {
    log,
    dbPath,
    cleanup: () => {
      log.close()
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    },
  }
}

/**
 * Deterministic clock. `advance(ms)` moves the fake now() forward.
 */
export function makeClock(start = 1_700_000_000_000): {
  now: () => number
  advance: (ms: number) => void
  set: (ms: number) => void
} {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
    set: (ms: number) => {
      current = ms
    },
  }
}
