import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Outbox, type OutboxOptions } from '../outbox.ts'
import { ServerRegistry, type ServerRegistryOptions } from '../server-registry.ts'

export interface TempRouter {
  readonly db: Database.Database
  readonly outbox: Outbox
  readonly registry: ServerRegistry
  readonly dbPath: string
  readonly cleanup: () => void
}

export function tempRouter(opts?: {
  clientId?: string
  now?: () => number
  outboxOpts?: Partial<OutboxOptions>
  registryOpts?: Partial<ServerRegistryOptions>
}): TempRouter {
  const dir = mkdtempSync(join(tmpdir(), 'wanda-router-test-'))
  const dbPath = join(dir, 'router.db')
  const db = new Database(dbPath)
  const outbox = new Outbox(db, {
    clientId: opts?.clientId ?? 'client-A',
    now: opts?.now,
    ...opts?.outboxOpts,
  })
  const registry = new ServerRegistry(db, {
    now: opts?.now,
    ...opts?.registryOpts,
  })
  return {
    db,
    outbox,
    registry,
    dbPath,
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    },
  }
}

/** Reopen the same DB file under a new router session. Simulates process restart. */
export function reopen(prev: TempRouter, opts?: { clientId?: string; now?: () => number }): TempRouter {
  try {
    prev.db.close()
  } catch {
    /* ignore */
  }
  const db = new Database(prev.dbPath)
  const outbox = new Outbox(db, {
    clientId: opts?.clientId ?? 'client-A',
    now: opts?.now,
  })
  const registry = new ServerRegistry(db, {
    now: opts?.now,
  })
  return {
    db,
    outbox,
    registry,
    dbPath: prev.dbPath,
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      try {
        rmSync(prev.dbPath.replace(/\/[^/]+$/, ''), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    },
  }
}
