// -----------------------------------------------------------------------------
// Outbox — SQLite-backed durable mutation queue.
//
// Every mutation the app fires while offline (or that's still in-flight
// when the client crashes) lives here until the server has acked its
// corresponding event-log entry. On app boot we reload the outbox, revalidate
// each entry's `ref` via the canonical `@wanda/wire` Zod schema, and retry
// anything that survived the cold start.
//
// spec §5.5
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import { AnyRefSchema, type AnyResourceRef } from '@wanda/wire'
import type Database from 'better-sqlite3'
import { OutboxEntryNotFoundError } from './errors.ts'
import { makeIdempotencyKey } from './idempotency-key.ts'
import { runMigrations } from './migrations.ts'
import type { Mutation, OutboxEntry } from './types.ts'

export interface OutboxOptions {
  readonly clientId: string
  /** Defaults to Date.now. */
  readonly now?: () => number
  /** Defaults to crypto.randomBytes-based UUIDs. */
  readonly newId?: () => string
  /** Override for tests. */
  readonly migrationsDir?: string
}

export class Outbox {
  private readonly clientId: string
  private readonly now: () => number
  private readonly newId: () => string

  private readonly stmts: {
    insert: Database.Statement
    selectById: Database.Statement
    selectByIdempotency: Database.Statement
    selectAll: Database.Statement
    incrementRetries: Database.Statement
    deleteById: Database.Statement
    count: Database.Statement
  }

  constructor(db: Database.Database, opts: OutboxOptions) {
    if (!opts.clientId) throw new Error('Outbox: clientId required')
    this.clientId = opts.clientId
    this.now = opts.now ?? Date.now
    this.newId = opts.newId ?? defaultId

    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 30000')
    runMigrations(db, opts.migrationsDir)

    this.stmts = {
      insert: db.prepare(
        'INSERT INTO outbox (id, idempotency_key, method, input_json, ref_json, created_at, retries, last_error) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)',
      ),
      selectById: db.prepare(
        'SELECT id, idempotency_key, method, input_json, ref_json, created_at, retries, last_error FROM outbox WHERE id = ?',
      ),
      selectByIdempotency: db.prepare(
        'SELECT id, idempotency_key, method, input_json, ref_json, created_at, retries, last_error FROM outbox WHERE idempotency_key = ?',
      ),
      selectAll: db.prepare(
        'SELECT id, idempotency_key, method, input_json, ref_json, created_at, retries, last_error FROM outbox ORDER BY created_at ASC',
      ),
      incrementRetries: db.prepare('UPDATE outbox SET retries = retries + 1, last_error = ? WHERE id = ?'),
      deleteById: db.prepare('DELETE FROM outbox WHERE id = ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM outbox'),
    }
  }

  // --- Writes ---------------------------------------------------------------

  /**
   * Enqueue a mutation. Returns the persisted entry. If a prior entry with
   * the same idempotency key exists, returns it instead of re-inserting —
   * ensures a React effect double-fire or a retry never creates duplicates.
   */
  enqueue(mutation: Mutation): OutboxEntry {
    if (!mutation || typeof mutation.method !== 'string' || mutation.method.length === 0) {
      throw new Error('enqueue: mutation.method required')
    }
    const id = this.newId()
    const idempotencyKey = makeIdempotencyKey(this.clientId, id)
    const existing = this.stmts.selectByIdempotency.get(idempotencyKey) as RawRow | undefined
    if (existing) return this.rowToEntry(existing)

    const ref = mutation.ref ?? null
    const refJson = ref ? JSON.stringify(ref) : null
    const input = mutation.input ?? null
    const inputJson = JSON.stringify(input)
    const createdAt = this.now()
    this.stmts.insert.run(id, idempotencyKey, mutation.method, inputJson, refJson, createdAt)
    return {
      id,
      idempotencyKey,
      method: mutation.method,
      input,
      ref,
      createdAt,
      retries: 0,
      lastError: null,
    }
  }

  markRetry(id: string, lastError?: string): OutboxEntry {
    const info = this.stmts.incrementRetries.run(lastError ?? null, id)
    if (info.changes === 0) throw new OutboxEntryNotFoundError(id)
    return this.findById(id)!
  }

  remove(id: string): boolean {
    return this.stmts.deleteById.run(id).changes > 0
  }

  // --- Reads ----------------------------------------------------------------

  findById(id: string): OutboxEntry | null {
    const row = this.stmts.selectById.get(id) as RawRow | undefined
    return row ? this.rowToEntry(row) : null
  }

  count(): number {
    return (this.stmts.count.get() as { n: number }).n
  }

  /**
   * Load the full outbox in `createdAt` order. Each entry's ref is
   * revalidated via the Zod `AnyRefSchema`; malformed refs (e.g. corrupted
   * by a schema change) are logged and the ref is nulled out. This prevents
   * a single bad row from wedging cold-start replay.
   */
  loadAll(onInvalidRef?: (id: string, ref: unknown) => void): OutboxEntry[] {
    const rows = this.stmts.selectAll.all() as RawRow[]
    return rows.map((r) => this.rowToEntry(r, onInvalidRef))
  }

  // --- Internals ------------------------------------------------------------

  private rowToEntry(r: RawRow, onInvalidRef?: (id: string, ref: unknown) => void): OutboxEntry {
    let ref: AnyResourceRef | null = null
    if (r.ref_json) {
      try {
        const parsed = JSON.parse(r.ref_json)
        const result = AnyRefSchema.safeParse(parsed)
        if (result.success) ref = result.data as AnyResourceRef
        else onInvalidRef?.(r.id, parsed)
      } catch {
        onInvalidRef?.(r.id, r.ref_json)
      }
    }
    let input: unknown = null
    try {
      input = JSON.parse(r.input_json)
    } catch {
      input = null
    }
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      method: r.method,
      input,
      ref,
      createdAt: r.created_at,
      retries: r.retries,
      lastError: r.last_error,
    }
  }
}

interface RawRow {
  id: string
  idempotency_key: string
  method: string
  input_json: string
  ref_json: string | null
  created_at: number
  retries: number
  last_error: string | null
}

function defaultId(): string {
  return randomBytes(16).toString('hex')
}
