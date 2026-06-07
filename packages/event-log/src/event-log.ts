// -----------------------------------------------------------------------------
// Core SQLite-backed event log.
//
// Publishes monotonically-sequenced events and streams them back on replay.
// The log is the source of truth clients use to:
//   - apply server-authoritative state transitions (via event appliers),
//   - bridge disconnect gaps without losing events,
//   - detect server restarts (epoch bump → full-resync trigger).
//
// This module covers the persistence + replay semantics. Gateway wiring
// (subscribe, fan-out) lives in @wanda/subscriptions + @wanda/gateway.
// -----------------------------------------------------------------------------

import type { EventChannel, ResourceKind } from '@wanda/wire'
import { EVENT_CHANNELS, RESOURCE_KINDS } from '@wanda/wire'
import Database from 'better-sqlite3'
import { EventLogClosedError, EventLogReadOnlyError, isDiskFullError, ReplayGoneError } from './errors.ts'
import { runMigrations } from './migrations.ts'
import type {
  DeleteByResourceResult,
  EventLogHealth,
  EventRecord,
  HealthListener,
  PruneOptions,
  PublishBatchInput,
  ReplayPageByResourceAllEpochsOptions,
  ReplayPageByResourceOptions,
  ReplayPageResult,
} from './types.ts'

export interface EventLogOptions {
  /**
   * Epoch at which this EventLog instance is operating. Bumped once per
   * server boot by the session layer; exposed to clients via hello-ack.
   */
  readonly epoch: number
  /** Override for tests / embedded uses. */
  readonly migrationsDir?: string
  /** Override for tests that want a preset clock. Defaults to Date.now. */
  readonly now?: () => number
}

const EVENT_CHANNEL_SET = new Set<string>(EVENT_CHANNELS)
const RESOURCE_KIND_SET = new Set<string>(RESOURCE_KINDS)

const DEFAULT_REPLAY_PAGE_SIZE = 1000

export class EventLog {
  private readonly db: Database.Database
  private readonly now: () => number
  private readonly ownsDb: boolean
  private _epoch: number
  private _closed = false
  private _readonly = false
  private _readonlyCause: string | undefined
  private readonly listeners = new Set<HealthListener>()

  // Prepared statements.
  private readonly stmts: {
    insertEvent: Database.Statement
    selectByEpochAfter: Database.Statement
    selectByResourceForward: Database.Statement
    selectByResourceBackward: Database.Statement
    selectByResourceForwardAllEpochs: Database.Statement
    selectByResourceBackwardAllEpochs: Database.Statement
    selectOldestSeq: Database.Statement
    selectOldestSeqByResource: Database.Statement
    selectCurrentSeq: Database.Statement
    countRows: Database.Statement
    pruneByAge: Database.Statement
    pruneByAgeAndKind: Database.Statement
    pruneOldestN: Database.Statement
    pruneOldestNByKind: Database.Statement
    countRowsByKind: Database.Statement
    selectResourceRange: Database.Statement
    deleteByResourceStmt: Database.Statement
    bytesForResourceStmt: Database.Statement
    recordEpochFirstSeq: Database.Statement
    selectEpochFirstSeq: Database.Statement
    recordResourceEpochFirstSeq: Database.Statement
    selectResourceEpochFirstSeq: Database.Statement
    deleteResourceEpochFirstSeq: Database.Statement
  }

  constructor(db: Database.Database, opts: EventLogOptions & { ownsDb?: boolean }) {
    if (!Number.isInteger(opts.epoch) || opts.epoch < 1) {
      throw new Error(`EventLog: epoch must be a positive integer (got ${opts.epoch})`)
    }
    this.db = db
    this._epoch = opts.epoch
    this.now = opts.now ?? Date.now
    this.ownsDb = opts.ownsDb ?? false

    // Apply PRAGMAs. `wal_autocheckpoint` runs every N pages written.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 30000')
    this.db.pragma('wal_autocheckpoint = 1000')

    runMigrations(this.db, opts.migrationsDir)

    this.stmts = {
      insertEvent: this.db.prepare(
        'INSERT INTO events (ts, epoch, channel, resource_kind, resource_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)',
      ),
      selectByEpochAfter: this.db.prepare(
        'SELECT seq, ts, epoch, channel, resource_kind, resource_id, payload_json FROM events WHERE epoch = ? AND seq > ? ORDER BY seq LIMIT ?',
      ),
      selectByResourceForward: this.db.prepare(
        'SELECT seq, ts, epoch, channel, resource_kind, resource_id, payload_json ' +
          'FROM events WHERE resource_kind = ? AND resource_id = ? AND epoch = ? AND seq > ? AND seq <= ? ' +
          'ORDER BY seq ASC LIMIT ?',
      ),
      selectByResourceBackward: this.db.prepare(
        'SELECT seq, ts, epoch, channel, resource_kind, resource_id, payload_json ' +
          'FROM events WHERE resource_kind = ? AND resource_id = ? AND epoch = ? AND seq > ? AND seq < ? ' +
          'ORDER BY seq DESC LIMIT ?',
      ),
      selectByResourceForwardAllEpochs: this.db.prepare(
        'SELECT seq, ts, epoch, channel, resource_kind, resource_id, payload_json ' +
          'FROM events WHERE resource_kind = ? AND resource_id = ? AND seq > ? AND seq <= ? ' +
          'ORDER BY seq ASC LIMIT ?',
      ),
      selectByResourceBackwardAllEpochs: this.db.prepare(
        'SELECT seq, ts, epoch, channel, resource_kind, resource_id, payload_json ' +
          'FROM events WHERE resource_kind = ? AND resource_id = ? AND seq > ? AND seq < ? ' +
          'ORDER BY seq DESC LIMIT ?',
      ),
      selectOldestSeq: this.db.prepare('SELECT MIN(seq) AS seq FROM events WHERE epoch = ?'),
      selectOldestSeqByResource: this.db.prepare(
        'SELECT MIN(seq) AS seq FROM events WHERE resource_kind = ? AND resource_id = ? AND epoch = ?',
      ),
      selectCurrentSeq: this.db.prepare('SELECT MAX(seq) AS seq FROM events'),
      countRows: this.db.prepare('SELECT COUNT(*) AS n FROM events'),
      pruneByAge: this.db.prepare('DELETE FROM events WHERE ts < ?'),
      pruneByAgeAndKind: this.db.prepare('DELETE FROM events WHERE ts < ? AND resource_kind = ?'),
      pruneOldestN: this.db.prepare('DELETE FROM events WHERE seq IN (SELECT seq FROM events ORDER BY seq LIMIT ?)'),
      pruneOldestNByKind: this.db.prepare(
        'DELETE FROM events WHERE seq IN (SELECT seq FROM events WHERE resource_kind = ? ORDER BY seq LIMIT ?)',
      ),
      countRowsByKind: this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE resource_kind = ?'),
      selectResourceRange: this.db.prepare(
        'SELECT MIN(seq) AS min_seq, MAX(seq) AS max_seq, COUNT(*) AS n FROM events WHERE resource_kind = ? AND resource_id = ?',
      ),
      deleteByResourceStmt: this.db.prepare('DELETE FROM events WHERE resource_kind = ? AND resource_id = ?'),
      bytesForResourceStmt: this.db.prepare(
        'SELECT COALESCE(SUM(LENGTH(payload_json)), 0) AS bytes FROM events WHERE resource_kind = ? AND resource_id = ?',
      ),
      // Record the very first seq published at each epoch. `INSERT OR IGNORE`
      // ensures only the initial publish wins; subsequent publishes are a
      // no-op even without a SELECT-before-check. We need this to distinguish
      // "pruning removed rows" from "epoch started at some seq > 1" (which
      // naturally happens when prior epochs consumed earlier AUTOINCREMENT
      // ids). The too-old detection relies on comparing current-oldest vs
      // epoch-first: if they differ, pruning has moved the floor.
      recordEpochFirstSeq: this.db.prepare(
        "INSERT OR IGNORE INTO _meta (key, value) VALUES ('epoch_first_seq:' || ?, ?)",
      ),
      selectEpochFirstSeq: this.db.prepare("SELECT value FROM _meta WHERE key = 'epoch_first_seq:' || ?"),
      recordResourceEpochFirstSeq: this.db.prepare(
        "INSERT OR IGNORE INTO _meta (key, value) VALUES ('resource_epoch_first_seq:' || ? || ':' || ? || ':' || ?, ?)",
      ),
      selectResourceEpochFirstSeq: this.db.prepare(
        "SELECT value FROM _meta WHERE key = 'resource_epoch_first_seq:' || ? || ':' || ? || ':' || ?",
      ),
      deleteResourceEpochFirstSeq: this.db.prepare(
        "DELETE FROM _meta WHERE key LIKE 'resource_epoch_first_seq:' || ? || ':' || ? || ':%'",
      ),
    }
  }

  // --- Publish --------------------------------------------------------------

  /**
   * Insert a new event row and return the committed record. When called
   * inside a better-sqlite3 `db.transaction(() => {...})()` wrapper (which
   * the domain-mutation middleware is responsible for establishing), the
   * event INSERT is atomic with the mutation — a disk-full or constraint
   * failure aborts both together.
   */
  publish(channel: EventChannel, resourceKind: ResourceKind, resourceId: string, payload: unknown): EventRecord {
    if (this._closed) throw new EventLogClosedError()
    if (this._readonly) throw new EventLogReadOnlyError(this._readonlyCause ?? 'unknown')

    if (!EVENT_CHANNEL_SET.has(channel)) {
      throw new Error(`EventLog.publish: unknown channel "${channel}"`)
    }
    if (!RESOURCE_KIND_SET.has(resourceKind)) {
      throw new Error(`EventLog.publish: unknown resourceKind "${resourceKind}"`)
    }
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error('EventLog.publish: resourceId must be a non-empty string')
    }

    const ts = this.now()
    const payloadJson = JSON.stringify(payload ?? null)
    try {
      const info = this.stmts.insertEvent.run(ts, this._epoch, channel, resourceKind, resourceId, payloadJson)
      const seq = Number(info.lastInsertRowid)
      // Record this as the epoch's first seq if no prior row exists for it.
      // INSERT OR IGNORE makes the check lock-free and idempotent.
      this.stmts.recordEpochFirstSeq.run(this._epoch, String(seq))
      this.stmts.recordResourceEpochFirstSeq.run(resourceKind, resourceId, this._epoch, String(seq))
      return {
        seq,
        ts,
        epoch: this._epoch,
        channel,
        resourceKind,
        resourceId,
        payload: payload ?? null,
      }
    } catch (err) {
      if (isDiskFullError(err)) {
        this.enterReadOnly('disk-full')
      }
      throw err
    }
  }

  // --- Replay ---------------------------------------------------------------

  /**
   * Fetch one page of events after `sinceSeq` for the given `sinceEpoch`.
   * Paginated so callers can stream large replays without holding a single
   * long-running transaction open. Each call runs in its own `BEGIN IMMEDIATE`
   * to block the pruner for the query's duration (see spec §4.2).
   */
  replayPage(sinceSeq: number, sinceEpoch: number, limit: number = DEFAULT_REPLAY_PAGE_SIZE): ReplayPageResult {
    if (this._closed) throw new EventLogClosedError()
    if (!Number.isInteger(sinceSeq) || sinceSeq < 0) {
      throw new Error(`EventLog.replayPage: sinceSeq must be >= 0 (got ${sinceSeq})`)
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`EventLog.replayPage: limit must be >= 1 (got ${limit})`)
    }

    if (sinceEpoch !== this._epoch) {
      return { ok: false, reason: 'epoch-mismatch' }
    }

    // BEGIN IMMEDIATE ensures the pruner (also IMMEDIATE) blocks while we
    // hold this read. We run the "too-old" check and the row fetch in the
    // same transaction so a concurrent prune can't delete rows between them.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Too-old detection. The only way the client can be too-old is if
      // pruning has moved the floor since their sinceSeq. We detect pruning
      // by comparing the current oldest seq for this epoch to the recorded
      // epoch_first_seq (set by the first publish of this epoch).
      //
      // Cases:
      //   - No events ever at this epoch (first_seq absent):
      //       client is ahead of schedule (fresh epoch, nothing to replay).
      //       Return empty page.
      //   - Events exist, no pruning (oldest === first_seq):
      //       every row from first_seq onward is reachable; no too-old.
      //   - Pruning has happened (oldest > first_seq, or oldest == null
      //     meaning everything pruned):
      //       sinceSeq + 1 < oldest → client missed pruned rows → too-old.
      //       oldest == null → all rows gone; any prior sinceSeq is too-old.
      const oldest = this.stmts.selectOldestSeq.get(this._epoch) as { seq: number | null }
      const firstRow = this.stmts.selectEpochFirstSeq.get(this._epoch) as { value: string } | undefined
      const firstSeq = firstRow ? Number(firstRow.value) : null

      if (firstSeq != null) {
        if (oldest.seq == null) {
          this.db.exec('COMMIT')
          return { ok: false, reason: 'too-old' }
        }
        if (oldest.seq > firstSeq && sinceSeq + 1 < oldest.seq) {
          this.db.exec('COMMIT')
          return { ok: false, reason: 'too-old' }
        }
      }

      const rows = this.stmts.selectByEpochAfter.all(this._epoch, sinceSeq, limit) as Array<{
        seq: number
        ts: number
        epoch: number
        channel: string
        resource_kind: string
        resource_id: string
        payload_json: string
      }>
      this.db.exec('COMMIT')

      const events: EventRecord[] = rows.map((r) => ({
        seq: r.seq,
        ts: r.ts,
        epoch: r.epoch,
        channel: r.channel as EventChannel,
        resourceKind: r.resource_kind as ResourceKind,
        resourceId: r.resource_id,
        payload: JSON.parse(r.payload_json) as unknown,
      }))

      const done = events.length < limit
      const nextCursor = events.length > 0 ? events[events.length - 1]!.seq : sinceSeq

      return { ok: true, events, done, nextCursor }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  /**
   * Convenience: drain all pages into a single array. Only safe for small
   * replays (tests, debugging). Production paths should stream pages.
   */
  replayAll(sinceSeq: number, sinceEpoch: number, pageSize = DEFAULT_REPLAY_PAGE_SIZE): ReplayPageResult {
    const all: EventRecord[] = []
    let cursor = sinceSeq
    while (true) {
      const page = this.replayPage(cursor, sinceEpoch, pageSize)
      if (!page.ok) return page
      all.push(...page.events)
      if (page.done) {
        return { ok: true, events: all, done: true, nextCursor: page.nextCursor }
      }
      // Defensive: if a page was full but returned no events, break to avoid loop.
      if (page.events.length === 0) {
        return { ok: true, events: all, done: true, nextCursor: cursor }
      }
      cursor = page.nextCursor
    }
  }

  /**
   * Raises ReplayGoneError on epoch-mismatch / too-old. Useful for callers
   * that prefer exceptions over result discrimination.
   */
  replayAllOrThrow(sinceSeq: number, sinceEpoch: number): EventRecord[] {
    const result = this.replayAll(sinceSeq, sinceEpoch)
    if (!result.ok) throw new ReplayGoneError(result.reason)
    return [...result.events]
  }

  /**
   * Fetch a page of events for a single resource (kind + id). Supports
   * forward (ASC from sinceSeq) and backward (DESC from upToSeq) paging.
   * `too-old` and `epoch-mismatch` semantics match `replayPage`, scoped
   * to the requested resource so unrelated resource deletes/prunes do not
   * poison this cursor.
   */
  replayPageByResource(
    resourceKind: ResourceKind,
    resourceId: string,
    opts: ReplayPageByResourceOptions,
  ): ReplayPageResult {
    if (this._closed) throw new EventLogClosedError()
    if (!RESOURCE_KIND_SET.has(resourceKind)) {
      throw new Error(`EventLog.replayPageByResource: unknown resourceKind "${resourceKind}"`)
    }
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error('EventLog.replayPageByResource: resourceId must be a non-empty string')
    }
    const { sinceSeq, sinceEpoch } = opts
    const direction = opts.direction ?? 'forward'
    const limit = opts.limit ?? DEFAULT_REPLAY_PAGE_SIZE
    if (!Number.isInteger(sinceSeq) || sinceSeq < 0) {
      throw new Error(`replayPageByResource: sinceSeq must be >= 0 (got ${sinceSeq})`)
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`replayPageByResource: limit must be >= 1 (got ${limit})`)
    }
    if (opts.upToSeq != null) {
      if (!Number.isInteger(opts.upToSeq) || opts.upToSeq < 0) {
        throw new Error(`replayPageByResource: upToSeq must be >= 0 (got ${opts.upToSeq})`)
      }
    }
    if (direction === 'backward' && opts.upToSeq == null) {
      throw new Error('replayPageByResource: backward direction requires upToSeq')
    }

    if (sinceEpoch !== this._epoch) {
      return { ok: false, reason: 'epoch-mismatch' }
    }

    // Open the same BEGIN IMMEDIATE envelope as `replayPage` so the pruner
    // can't delete rows between the too-old check and the row fetch.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const oldest = this.stmts.selectOldestSeqByResource.get(resourceKind, resourceId, this._epoch) as {
        seq: number | null
      }
      const firstRow = this.stmts.selectResourceEpochFirstSeq.get(resourceKind, resourceId, this._epoch) as
        | { value: string }
        | undefined
      const firstSeq = firstRow ? Number(firstRow.value) : null

      if (firstSeq != null) {
        if (oldest.seq == null) {
          this.db.exec('COMMIT')
          return { ok: false, reason: 'too-old' }
        }
        if (oldest.seq > firstSeq && sinceSeq + 1 < oldest.seq) {
          this.db.exec('COMMIT')
          return { ok: false, reason: 'too-old' }
        }
      }

      // MAX_SAFE_INTEGER as a practical ceiling for uncapped forward reads.
      // Backward reads require upToSeq (validated above).
      const upperBound = opts.upToSeq ?? Number.MAX_SAFE_INTEGER
      const stmt = direction === 'forward' ? this.stmts.selectByResourceForward : this.stmts.selectByResourceBackward
      const rows = stmt.all(resourceKind, resourceId, this._epoch, sinceSeq, upperBound, limit) as Array<{
        seq: number
        ts: number
        epoch: number
        channel: string
        resource_kind: string
        resource_id: string
        payload_json: string
      }>
      this.db.exec('COMMIT')

      const events: EventRecord[] = rows.map((r) => ({
        seq: r.seq,
        ts: r.ts,
        epoch: r.epoch,
        channel: r.channel as EventChannel,
        resourceKind: r.resource_kind as ResourceKind,
        resourceId: r.resource_id,
        payload: JSON.parse(r.payload_json) as unknown,
      }))

      const done = events.length < limit
      // `nextCursor` semantics:
      //   forward — pass back as sinceSeq on the next call (ASC, so last row is the largest seq)
      //   backward — pass back as upToSeq on the next call (DESC, so last row is the smallest seq)
      const nextCursor =
        events.length > 0
          ? events[events.length - 1]!.seq
          : direction === 'forward'
            ? sinceSeq
            : (opts.upToSeq ?? sinceSeq)

      return { ok: true, events, done, nextCursor }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  replayPageByResourceAllEpochs(
    resourceKind: ResourceKind,
    resourceId: string,
    opts: ReplayPageByResourceAllEpochsOptions,
  ): ReplayPageResult {
    if (this._closed) throw new EventLogClosedError()
    if (!RESOURCE_KIND_SET.has(resourceKind)) {
      throw new Error(`EventLog.replayPageByResourceAllEpochs: unknown resourceKind "${resourceKind}"`)
    }
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error('EventLog.replayPageByResourceAllEpochs: resourceId must be a non-empty string')
    }
    const direction = opts.direction ?? 'forward'
    const limit = opts.limit ?? DEFAULT_REPLAY_PAGE_SIZE
    if (!Number.isInteger(opts.sinceSeq) || opts.sinceSeq < 0) {
      throw new Error(`replayPageByResourceAllEpochs: sinceSeq must be >= 0 (got ${opts.sinceSeq})`)
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`replayPageByResourceAllEpochs: limit must be >= 1 (got ${limit})`)
    }
    if (opts.upToSeq != null && (!Number.isInteger(opts.upToSeq) || opts.upToSeq < 0)) {
      throw new Error(`replayPageByResourceAllEpochs: upToSeq must be >= 0 (got ${opts.upToSeq})`)
    }
    if (direction === 'backward' && opts.upToSeq == null) {
      throw new Error('replayPageByResourceAllEpochs: backward direction requires upToSeq')
    }

    const upperBound = opts.upToSeq ?? Number.MAX_SAFE_INTEGER
    const stmt =
      direction === 'forward'
        ? this.stmts.selectByResourceForwardAllEpochs
        : this.stmts.selectByResourceBackwardAllEpochs
    const rows = stmt.all(resourceKind, resourceId, opts.sinceSeq, upperBound, limit) as Array<{
      seq: number
      ts: number
      epoch: number
      channel: string
      resource_kind: string
      resource_id: string
      payload_json: string
    }>
    const events: EventRecord[] = rows.map((r) => ({
      seq: r.seq,
      ts: r.ts,
      epoch: r.epoch,
      channel: r.channel as EventChannel,
      resourceKind: r.resource_kind as ResourceKind,
      resourceId: r.resource_id,
      payload: JSON.parse(r.payload_json) as unknown,
    }))
    const done = events.length < limit
    const nextCursor =
      events.length > 0
        ? events[events.length - 1]!.seq
        : direction === 'forward'
          ? opts.sinceSeq
          : (opts.upToSeq ?? opts.sinceSeq)
    return { ok: true, events, done, nextCursor }
  }

  /**
   * Delete every row for a single resource. Returns the seq range that was
   * removed so callers can invalidate attached subscribers. Safe to call on
   * a resource with no rows — returns zeros.
   */
  deleteByResource(resourceKind: ResourceKind, resourceId: string): DeleteByResourceResult {
    if (this._closed) throw new EventLogClosedError()
    if (this._readonly) throw new EventLogReadOnlyError(this._readonlyCause ?? 'unknown')
    if (!RESOURCE_KIND_SET.has(resourceKind)) {
      throw new Error(`EventLog.deleteByResource: unknown resourceKind "${resourceKind}"`)
    }
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error('EventLog.deleteByResource: resourceId must be a non-empty string')
    }

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const range = this.stmts.selectResourceRange.get(resourceKind, resourceId) as {
        min_seq: number | null
        max_seq: number | null
        n: number
      }
      if (range.n === 0) {
        this.db.exec('COMMIT')
        return { rowsDeleted: 0, minSeq: null, maxSeq: null }
      }
      const info = this.stmts.deleteByResourceStmt.run(resourceKind, resourceId)
      this.stmts.deleteResourceEpochFirstSeq.run(resourceKind, resourceId)
      this.db.exec('COMMIT')
      return {
        rowsDeleted: info.changes,
        minSeq: range.min_seq,
        maxSeq: range.max_seq,
      }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  /**
   * Atomic multi-row append. All rows land in a single transaction so a
   * partial failure rolls back every inserted row. Used for compound
   * sequences like `turn.started` + `permission.resolved` that subscribers
   * should never observe half-applied.
   */
  publishBatch(events: ReadonlyArray<PublishBatchInput>): EventRecord[] {
    if (this._closed) throw new EventLogClosedError()
    if (this._readonly) throw new EventLogReadOnlyError(this._readonlyCause ?? 'unknown')
    if (events.length === 0) return []

    for (const e of events) {
      if (!EVENT_CHANNEL_SET.has(e.channel)) {
        throw new Error(`EventLog.publishBatch: unknown channel "${e.channel}"`)
      }
      if (!RESOURCE_KIND_SET.has(e.resourceKind)) {
        throw new Error(`EventLog.publishBatch: unknown resourceKind "${e.resourceKind}"`)
      }
      if (typeof e.resourceId !== 'string' || e.resourceId.length === 0) {
        throw new Error('EventLog.publishBatch: resourceId must be a non-empty string')
      }
    }

    const ts = this.now()
    const records: EventRecord[] = []
    try {
      const txn = this.db.transaction((batch: ReadonlyArray<PublishBatchInput>) => {
        for (const e of batch) {
          const payloadJson = JSON.stringify(e.payload ?? null)
          const info = this.stmts.insertEvent.run(ts, this._epoch, e.channel, e.resourceKind, e.resourceId, payloadJson)
          const seq = Number(info.lastInsertRowid)
          this.stmts.recordEpochFirstSeq.run(this._epoch, String(seq))
          this.stmts.recordResourceEpochFirstSeq.run(e.resourceKind, e.resourceId, this._epoch, String(seq))
          records.push({
            seq,
            ts,
            epoch: this._epoch,
            channel: e.channel,
            resourceKind: e.resourceKind,
            resourceId: e.resourceId,
            payload: e.payload ?? null,
          })
        }
      })
      txn(events)
      return records
    } catch (err) {
      if (isDiskFullError(err)) {
        this.enterReadOnly('disk-full')
      }
      throw err
    }
  }

  /**
   * Total payload bytes (sum of payload_json lengths) for a single
   * resource. Used by the settings UI to surface per-session storage cost;
   * excludes SQLite row overhead.
   */
  bytesForResource(resourceKind: ResourceKind, resourceId: string): number {
    if (this._closed) throw new EventLogClosedError()
    if (!RESOURCE_KIND_SET.has(resourceKind)) {
      throw new Error(`EventLog.bytesForResource: unknown resourceKind "${resourceKind}"`)
    }
    if (typeof resourceId !== 'string' || resourceId.length === 0) {
      throw new Error('EventLog.bytesForResource: resourceId must be a non-empty string')
    }
    const row = this.stmts.bytesForResourceStmt.get(resourceKind, resourceId) as {
      bytes: number | null
    }
    return row.bytes ?? 0
  }

  // --- Cursors --------------------------------------------------------------

  currentEpoch(): number {
    return this._epoch
  }

  currentSeq(): number {
    if (this._closed) throw new EventLogClosedError()
    const row = this.stmts.selectCurrentSeq.get() as { seq: number | null }
    return row.seq ?? 0
  }

  rowCount(): number {
    if (this._closed) throw new EventLogClosedError()
    const row = this.stmts.countRows.get() as { n: number }
    return row.n
  }

  // --- Pruning --------------------------------------------------------------

  /**
   * Delete old rows. Runs in a single `BEGIN IMMEDIATE` to serialize with
   * in-flight replay pages. Returns the number of rows removed.
   */
  prune(opts: PruneOptions): number {
    if (this._closed) throw new EventLogClosedError()
    if (this._readonly) throw new EventLogReadOnlyError(this._readonlyCause ?? 'unknown')
    if (opts.resourceKind != null && !RESOURCE_KIND_SET.has(opts.resourceKind)) {
      throw new Error(`prune: unknown resourceKind "${opts.resourceKind}"`)
    }

    let total = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (opts.maxAgeMs != null) {
        if (!Number.isFinite(opts.maxAgeMs) || opts.maxAgeMs < 0) {
          throw new Error(`prune: maxAgeMs must be >= 0 (got ${opts.maxAgeMs})`)
        }
        const cutoff = this.now() - opts.maxAgeMs
        total +=
          opts.resourceKind != null
            ? this.stmts.pruneByAgeAndKind.run(cutoff, opts.resourceKind).changes
            : this.stmts.pruneByAge.run(cutoff).changes
      }
      if (opts.maxRows != null) {
        if (!Number.isInteger(opts.maxRows) || opts.maxRows < 0) {
          throw new Error(`prune: maxRows must be a non-negative integer (got ${opts.maxRows})`)
        }
        const currentCount =
          opts.resourceKind != null
            ? (this.stmts.countRowsByKind.get(opts.resourceKind) as { n: number }).n
            : (this.stmts.countRows.get() as { n: number }).n
        const excess = currentCount - opts.maxRows
        if (excess > 0) {
          total +=
            opts.resourceKind != null
              ? this.stmts.pruneOldestNByKind.run(opts.resourceKind, excess).changes
              : this.stmts.pruneOldestN.run(excess).changes
        }
      }
      this.db.exec('COMMIT')
      return total
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* already rolled back */
      }
      throw err
    }
  }

  // --- Health ---------------------------------------------------------------

  health(): EventLogHealth {
    return this._readonly ? { status: 'degraded', cause: this._readonlyCause ?? 'unknown' } : { status: 'healthy' }
  }

  onHealthChange(listener: HealthListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Force the log into read-only mode. Primarily called internally on
   * disk-full detection; exposed for the session layer to propagate
   * server-wide read-only states if needed.
   */
  enterReadOnly(cause: string): void {
    if (this._readonly) return
    this._readonly = true
    this._readonlyCause = cause
    this.emitHealth()
  }

  exitReadOnly(): void {
    if (!this._readonly) return
    this._readonly = false
    this._readonlyCause = undefined
    this.emitHealth()
  }

  private emitHealth(): void {
    const h = this.health()
    for (const l of this.listeners) {
      try {
        l(h)
      } catch (err) {
        // Listeners must never halt the event log. Log, keep iterating.
        // eslint-disable-next-line no-console
        console.error('[event-log] health listener threw', err)
      }
    }
  }

  // --- Lifecycle ------------------------------------------------------------

  setEpoch(epoch: number): void {
    if (this._closed) throw new EventLogClosedError()
    if (!Number.isInteger(epoch) || epoch < 1) {
      throw new Error(`setEpoch: epoch must be a positive integer (got ${epoch})`)
    }
    this._epoch = epoch
  }

  close(): void {
    if (this._closed) return
    this._closed = true
    this.listeners.clear()
    if (this.ownsDb) {
      try {
        this.db.close()
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Open an event log at the given SQLite path. The returned instance owns the
 * underlying `Database` handle and closes it on `close()`.
 *
 * Callers who want to share a DB handle (e.g. the app's main SQLite) should
 * construct `EventLog` directly and pass `ownsDb: false`.
 */
export function openEventLog(path: string, opts: EventLogOptions): EventLog {
  const db = new Database(path)
  try {
    return new EventLog(db, { ...opts, ownsDb: true })
  } catch (err) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    throw err
  }
}
