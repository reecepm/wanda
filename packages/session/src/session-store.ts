// -----------------------------------------------------------------------------
// SessionStore — durable paired-client sessions, server identity, and tokens.
//
// Covers three responsibilities:
//   1. Server identity (stable serverId + epoch) persisted once per install.
//   2. Long-lived session rows keyed by clientId; sessionToken bearers for HTTP.
//   3. Short-lived wsTokens (in-memory), consumed once on WS upgrade.
//
// Grace-window tracking (§4.3) is in-memory per-process state — it doesn't
// survive process restart, by design: after a crash the user's subscriptions
// are re-established from scratch, grace is moot.
// -----------------------------------------------------------------------------

import { randomBytes as nodeRandomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { crc32Of } from './crc.ts'
import { ServerIdentityCorruptedError, SessionExpiredError, SessionNotFoundError } from './errors.ts'
import { runMigrations } from './migrations.ts'
import type { ConsumedWsToken, GraceState, ServerIdentity, Session, SessionStoreConfig, WsTokenGrant } from './types.ts'

const DEFAULT_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const DEFAULT_WS_TOKEN_LIFETIME_MS = 30 * 1000 // 30 seconds
const DEFAULT_GRACE_WINDOW_MS = 10 * 1000 // 10 seconds

const SESSION_ID_BYTES = 16
const SESSION_TOKEN_BYTES = 32
const WS_TOKEN_BYTES = 24
const SERVER_ID_BYTES = 16

export class SessionStore {
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private readonly now: () => number
  private readonly sessionLifetimeMs: number
  private readonly wsTokenLifetimeMs: number
  private readonly graceWindowMs: number
  private readonly randomBytes: (size: number) => Buffer

  // Server identity, loaded (or created) on constructor.
  private _identity: ServerIdentity

  // wsToken: in-memory map only. Short-lived; crash resets them naturally.
  private readonly wsTokens = new Map<string, { sessionId: string; expiresAt: number }>()

  // Grace state: in-memory per-process only.
  private readonly grace = new Map<string, GraceState>() // clientId → GraceState

  private _closed = false

  private readonly stmts: {
    selectIdentity: Database.Statement
    insertIdentity: Database.Statement
    bumpEpoch: Database.Statement
    deleteIdentity: Database.Statement
    insertSession: Database.Statement
    selectSessionById: Database.Statement
    selectSessionByToken: Database.Statement
    selectSessionByClientId: Database.Statement
    deleteSession: Database.Statement
    touchSession: Database.Statement
    selectAllSessions: Database.Statement
    deleteExpiredSessions: Database.Statement
  }

  constructor(db: Database.Database, config: SessionStoreConfig & { ownsDb?: boolean } = {}) {
    this.db = db
    this.ownsDb = config.ownsDb ?? false
    this.now = config.now ?? Date.now
    this.sessionLifetimeMs = config.sessionLifetimeMs ?? DEFAULT_SESSION_LIFETIME_MS
    this.wsTokenLifetimeMs = config.wsTokenLifetimeMs ?? DEFAULT_WS_TOKEN_LIFETIME_MS
    this.graceWindowMs = config.graceWindowMs ?? DEFAULT_GRACE_WINDOW_MS
    this.randomBytes = config.randomBytes ?? ((size: number) => Buffer.from(nodeRandomBytes(size)))

    // Same PRAGMAs as event-log. Idempotent if already set by another package.
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('busy_timeout = 30000')

    runMigrations(this.db, config.migrationsDir)

    this.stmts = {
      selectIdentity: this.db.prepare('SELECT id, created_at, epoch, epoch_crc FROM server_identity LIMIT 1'),
      insertIdentity: this.db.prepare(
        'INSERT INTO server_identity (id, created_at, epoch, epoch_crc) VALUES (?, ?, ?, ?)',
      ),
      bumpEpoch: this.db.prepare('UPDATE server_identity SET epoch = ?, epoch_crc = ? WHERE id = ?'),
      deleteIdentity: this.db.prepare('DELETE FROM server_identity'),
      insertSession: this.db.prepare(
        'INSERT INTO sessions (session_id, client_id, session_token, device_label, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ),
      selectSessionById: this.db.prepare(
        'SELECT session_id, client_id, session_token, device_label, created_at, expires_at, last_seen_at FROM sessions WHERE session_id = ?',
      ),
      selectSessionByToken: this.db.prepare(
        'SELECT session_id, client_id, session_token, device_label, created_at, expires_at, last_seen_at FROM sessions WHERE session_token = ?',
      ),
      selectSessionByClientId: this.db.prepare(
        'SELECT session_id, client_id, session_token, device_label, created_at, expires_at, last_seen_at FROM sessions WHERE client_id = ?',
      ),
      deleteSession: this.db.prepare('DELETE FROM sessions WHERE session_id = ?'),
      touchSession: this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE session_id = ?'),
      selectAllSessions: this.db.prepare(
        'SELECT session_id, client_id, session_token, device_label, created_at, expires_at, last_seen_at FROM sessions ORDER BY created_at',
      ),
      deleteExpiredSessions: this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    }

    this._identity = this.bootServerIdentity()
  }

  // --- Server identity ------------------------------------------------------

  identity(): ServerIdentity {
    this.assertOpen()
    return this._identity
  }

  /**
   * Delete the server identity row. Admin-only, forces all paired clients to
   * re-pair. Next call to `identity()` would re-create fresh — but this
   * instance stops at this call; callers must restart the process.
   */
  resetIdentity(): void {
    this.assertOpen()
    this.stmts.deleteIdentity.run()
    // Re-create with a new id on the next boot — we regenerate immediately so
    // the running process sees a coherent identity even before restart. This
    // leaves all existing sessions orphaned (their serverId no longer matches
    // ours), so callers should typically also `clearAllSessions()`.
    this._identity = this.bootServerIdentity()
  }

  private bootServerIdentity(): ServerIdentity {
    const existing = this.stmts.selectIdentity.get() as
      | { id: string; created_at: number; epoch: number; epoch_crc: number }
      | undefined

    if (!existing) {
      const id = this.randomBytes(SERVER_ID_BYTES).toString('hex')
      const createdAt = this.now()
      const epoch = 1
      const epochCrc = crc32Of(epoch)
      this.stmts.insertIdentity.run(id, createdAt, epoch, epochCrc)
      return { id, createdAt, epoch }
    }

    const expectedCrc = crc32Of(existing.epoch)
    if (expectedCrc !== existing.epoch_crc) {
      throw new ServerIdentityCorruptedError(existing.epoch, existing.epoch_crc, expectedCrc)
    }

    // Bump epoch for this boot so every client knows to validate their resume.
    const nextEpoch = existing.epoch + 1
    const nextCrc = crc32Of(nextEpoch)
    this.stmts.bumpEpoch.run(nextEpoch, nextCrc, existing.id)
    return { id: existing.id, createdAt: existing.created_at, epoch: nextEpoch }
  }

  // --- Sessions -------------------------------------------------------------

  createSession(opts: { clientId: string; deviceLabel: string }): Session {
    this.assertOpen()
    if (!opts.clientId || typeof opts.clientId !== 'string') {
      throw new Error('createSession: clientId must be a non-empty string')
    }
    if (!opts.deviceLabel || typeof opts.deviceLabel !== 'string') {
      throw new Error('createSession: deviceLabel must be a non-empty string')
    }

    // One session per client. If a session exists for this clientId, replace:
    // generate a new sessionId + sessionToken so the old device is forcibly
    // signed out. This matches spec §4.3's per-device model.
    const existing = this.findByClientId(opts.clientId)
    if (existing) {
      this.revoke(existing.sessionId)
    }

    const sessionId = this.randomBytes(SESSION_ID_BYTES).toString('hex')
    const sessionToken = this.randomBytes(SESSION_TOKEN_BYTES).toString('base64url')
    const now = this.now()
    const expiresAt = now + this.sessionLifetimeMs

    this.stmts.insertSession.run(sessionId, opts.clientId, sessionToken, opts.deviceLabel, now, expiresAt, now)

    return {
      sessionId,
      clientId: opts.clientId,
      sessionToken,
      deviceLabel: opts.deviceLabel,
      createdAt: now,
      expiresAt,
      lastSeenAt: now,
    }
  }

  findById(sessionId: string): Session | null {
    this.assertOpen()
    return this.rowToSession(this.stmts.selectSessionById.get(sessionId))
  }

  findByToken(sessionToken: string): Session | null {
    this.assertOpen()
    return this.rowToSession(this.stmts.selectSessionByToken.get(sessionToken))
  }

  findByClientId(clientId: string): Session | null {
    this.assertOpen()
    return this.rowToSession(this.stmts.selectSessionByClientId.get(clientId))
  }

  /**
   * Authenticate a bearer token. Returns the session if valid and unexpired,
   * throws on expiry so the caller can distinguish from "not-found".
   */
  authenticateBearer(sessionToken: string): Session {
    const session = this.findByToken(sessionToken)
    if (!session) throw new SessionNotFoundError(`token prefix=${sessionToken.slice(0, 6)}`)
    if (this.now() >= session.expiresAt) {
      this.revoke(session.sessionId)
      throw new SessionExpiredError(session.sessionId)
    }
    return session
  }

  list(): Session[] {
    this.assertOpen()
    const rows = this.stmts.selectAllSessions.all() as RawSessionRow[]
    return rows.map((r) => this.rowToSession(r)!)
  }

  touch(sessionId: string): void {
    this.assertOpen()
    const info = this.stmts.touchSession.run(this.now(), sessionId)
    if (info.changes === 0) throw new SessionNotFoundError(sessionId)
  }

  revoke(sessionId: string): boolean {
    this.assertOpen()
    const info = this.stmts.deleteSession.run(sessionId)
    // Also drop any wsTokens and grace state tied to this session.
    for (const [tok, data] of this.wsTokens) {
      if (data.sessionId === sessionId) this.wsTokens.delete(tok)
    }
    for (const [clientId, state] of this.grace) {
      if (state.sessionId === sessionId) this.grace.delete(clientId)
    }
    return info.changes > 0
  }

  purgeExpired(): number {
    this.assertOpen()
    const info = this.stmts.deleteExpiredSessions.run(this.now())
    return info.changes
  }

  // --- wsToken --------------------------------------------------------------

  issueWsToken(sessionId: string): WsTokenGrant {
    this.assertOpen()
    const session = this.findById(sessionId)
    if (!session) throw new SessionNotFoundError(sessionId)
    if (this.now() >= session.expiresAt) throw new SessionExpiredError(sessionId)

    const wsToken = this.randomBytes(WS_TOKEN_BYTES).toString('base64url')
    const expiresAt = this.now() + this.wsTokenLifetimeMs
    this.wsTokens.set(wsToken, { sessionId, expiresAt })
    return { wsToken, expiresAt }
  }

  /**
   * One-shot consume. The token is removed from the store regardless of
   * validity, so a second attempt with the same token always fails. The
   * returned object tells the caller why it failed when ok=false.
   */
  consumeWsToken(wsToken: string): ConsumedWsToken {
    this.assertOpen()
    const entry = this.wsTokens.get(wsToken)
    if (!entry) return { ok: false, reason: 'not-found' }
    // Delete first — ensures "already-consumed" semantics even if the rest of
    // this function throws.
    this.wsTokens.delete(wsToken)
    if (this.now() >= entry.expiresAt) return { ok: false, reason: 'expired' }
    const session = this.findById(entry.sessionId)
    if (!session) return { ok: false, reason: 'not-found' }
    return { ok: true, sessionId: entry.sessionId, clientId: session.clientId }
  }

  /**
   * Drop expired wsTokens from memory. Called periodically by the gateway;
   * not load-bearing for correctness (consume checks expiry) but keeps the
   * map from growing unboundedly on a busy server.
   */
  purgeExpiredWsTokens(): number {
    const now = this.now()
    let removed = 0
    for (const [tok, entry] of this.wsTokens) {
      if (now >= entry.expiresAt) {
        this.wsTokens.delete(tok)
        removed++
      }
    }
    return removed
  }

  // --- Grace window ---------------------------------------------------------

  /**
   * Signal that a WS connection for this client has closed. Starts the grace
   * window countdown. Subsequent `isWithinGrace(clientId)` returns true for
   * `graceWindowMs`; after that, subscription state is expected to have been
   * purged by @wanda/subscriptions.
   */
  markDisconnected(sessionId: string): void {
    this.assertOpen()
    const session = this.findById(sessionId)
    if (!session) return // nothing to do; session already revoked
    this.grace.set(session.clientId, {
      sessionId,
      disconnectedAt: this.now(),
    })
  }

  /**
   * Is this client eligible to resume an in-flight session without losing
   * subscriptions? True IFF the grace window hasn't elapsed since the last
   * WS close. After the grace window expires, we return false AND clean up
   * the tracking entry so state doesn't grow.
   */
  isWithinGrace(clientId: string): boolean {
    const entry = this.grace.get(clientId)
    if (!entry) return false
    if (this.now() - entry.disconnectedAt <= this.graceWindowMs) return true
    this.grace.delete(clientId)
    return false
  }

  /**
   * Signal that a fresh WS connection for this client has been accepted.
   * Clears the grace entry so a subsequent disconnect starts a new window.
   */
  clearGrace(clientId: string): void {
    this.grace.delete(clientId)
  }

  // --- Lifecycle ------------------------------------------------------------

  close(): void {
    if (this._closed) return
    this._closed = true
    this.wsTokens.clear()
    this.grace.clear()
    if (this.ownsDb) {
      try {
        this.db.close()
      } catch {
        /* ignore */
      }
    }
  }

  private assertOpen(): void {
    if (this._closed) throw new Error('SessionStore: operation after close()')
  }

  private rowToSession(row: unknown): Session | null {
    if (!row) return null
    const r = row as RawSessionRow
    return {
      sessionId: r.session_id,
      clientId: r.client_id,
      sessionToken: r.session_token,
      deviceLabel: r.device_label,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      lastSeenAt: r.last_seen_at,
    }
  }
}

interface RawSessionRow {
  session_id: string
  client_id: string
  session_token: string
  device_label: string
  created_at: number
  expires_at: number
  last_seen_at: number
}

/**
 * Open a SessionStore backed by a SQLite file at `path`. The store owns the
 * database handle and closes it on `close()`.
 */
export function openSessionStore(path: string, config: SessionStoreConfig = {}): SessionStore {
  const db = new Database(path)
  try {
    return new SessionStore(db, { ...config, ownsDb: true })
  } catch (err) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    throw err
  }
}
