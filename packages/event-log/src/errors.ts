// -----------------------------------------------------------------------------
// Errors specific to @wanda/event-log.
// -----------------------------------------------------------------------------

export type ReplayGoneReason =
  /** Client's epoch doesn't match server's current epoch (server was restarted). */
  | 'epoch-mismatch'
  /** Client's sinceSeq points at a row that has been pruned. */
  | 'too-old'

export class ReplayGoneError extends Error {
  readonly reason: ReplayGoneReason
  constructor(reason: ReplayGoneReason) {
    super(`event-log replay-gone: ${reason}`)
    this.name = 'ReplayGoneError'
    this.reason = reason
  }
}

export class EventLogClosedError extends Error {
  constructor() {
    super('event-log: operation attempted after close()')
    this.name = 'EventLogClosedError'
  }
}

export class EventLogReadOnlyError extends Error {
  readonly cause: string
  constructor(cause: string) {
    super(`event-log: read-only mode (${cause})`)
    this.name = 'EventLogReadOnlyError'
    this.cause = cause
  }
}

export class MigrationError extends Error {
  readonly migrationId: string
  constructor(migrationId: string, message: string) {
    super(`event-log migration ${migrationId} failed: ${message}`)
    this.name = 'MigrationError'
    this.migrationId = migrationId
  }
}

/**
 * Detects the better-sqlite3 disk-full error code. better-sqlite3 throws
 * `SqliteError` instances with a `code` property set to the SQLite constant.
 */
export function isDiskFullError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'SQLITE_FULL' || code === 'SQLITE_IOERR_WRITE'
}
