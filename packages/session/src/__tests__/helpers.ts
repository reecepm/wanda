// -----------------------------------------------------------------------------
// Shared test helpers for @wanda/session.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { SessionStore } from '../session-store.ts'
import type { SessionStoreConfig } from '../types.ts'

export interface TempSessionStore {
  readonly store: SessionStore
  readonly dir: string
  readonly dbPath: string
  readonly cleanup: () => void
}

/**
 * Create a SessionStore against a fresh file DB. On-disk so WAL behaviour
 * matches production.
 */
export function makeTempSessionStore(config?: SessionStoreConfig): TempSessionStore {
  const dir = mkdtempSync(join(tmpdir(), 'wanda-session-test-'))
  const dbPath = join(dir, 'session.db')
  const db = new Database(dbPath)
  const store = new SessionStore(db, { ...config, ownsDb: true })
  return {
    store,
    dir,
    dbPath,
    cleanup: () => {
      store.close()
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    },
  }
}

/**
 * Reopen the same DB file under a fresh SessionStore instance. Simulates a
 * process restart — epoch bump should be observable, identity id persists.
 */
export function reopenSessionStore(prev: TempSessionStore, config?: SessionStoreConfig): TempSessionStore {
  prev.store.close()
  const db = new Database(prev.dbPath)
  const store = new SessionStore(db, { ...config, ownsDb: true })
  return {
    store,
    dir: prev.dir,
    dbPath: prev.dbPath,
    cleanup: () => {
      store.close()
      try {
        rmSync(prev.dir, { recursive: true, force: true })
      } catch {
        /* best-effort */
      }
    },
  }
}

/** Deterministic clock. */
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

/**
 * Deterministic "random" bytes. Each call returns sequential bytes from a
 * counter, so token values are predictable in tests.
 */
export function makeSeededRandom(seed = 0xdeadbeef): (size: number) => Buffer {
  let counter = seed >>> 0
  return (size: number): Buffer => {
    const buf = Buffer.alloc(size)
    for (let i = 0; i < size; i++) {
      buf[i] = counter & 0xff
      // Linear congruential-ish step — good enough for distinct bytes; we
      // only care that repeated calls produce distinct sequences.
      counter = (counter * 1103515245 + 12345) & 0xffffffff
    }
    return buf
  }
}
