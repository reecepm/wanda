// -----------------------------------------------------------------------------
// Pairing + session + ws-token layer.
//
// Protocol:
//   1. Server prints a pairing URL containing a short-lived single-use
//      pairing token.
//   2. Client POSTs the pairing token to /api/auth/bootstrap and receives
//      a long-lived session token + sessionId.
//   3. Before opening a WebSocket, the client swaps its session token for
//      a 30s-lived one-shot wsToken via /api/auth/ws-token.
//
// Session persistence + wsToken minting are delegated to
// `@wanda/session.SessionStore`. Pairing tokens remain in-memory here —
// they're short-lived and safe to drop on restart.
// -----------------------------------------------------------------------------
//
// Device-info encoding:
//   `SessionStore.createSession` takes a single opaque `deviceLabel` string.
//   `PairedClientInfo` has three fields. We JSON-encode the full record into
//   `deviceLabel` on write and parse it back on read; if parsing fails we
//   treat the stored label as a bare `deviceName` so older rows (if any)
//   still surface something.
// -----------------------------------------------------------------------------

import { randomBytes as cryptoRandomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SessionStore } from '@wanda/session'
import Database from 'better-sqlite3'
import type {
  BootstrapResult,
  PairedClientInfo,
  PairedSessionSummary,
  SessionRole,
  WsTokenResult,
} from '../../shared/contracts/auth'
import type { ServerCapabilities } from '../../shared/contracts/capabilities'
import type { AppDatabase } from '../db/connection'
import { log } from '../packages/logger'

const DEFAULT_PAIRING_TTL_MS = 15 * 60 * 1000
const DEFAULT_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
const DEFAULT_WS_TOKEN_TTL_MS = 30 * 1000

const LOCAL_SHELL_ROLE: SessionRole = 'owner'
const PAIRED_CLIENT_ROLE: SessionRole = 'owner'

interface PairingRecord {
  readonly token: string
  readonly expiresAt: number
}

export interface AuthStoreOptions {
  readonly pairingTokenTtlMs?: number
  readonly sessionTokenTtlMs?: number
  readonly wsTokenTtlMs?: number
  /**
   * Drizzle handle for the app's SQLite database. When omitted the store
   * falls back to an in-memory SQLite db — fine for unit tests that don't
   * need sessions to survive `createInMemoryAuthStore()` re-instantiation.
   */
  readonly db?: AppDatabase
  /** Override the session-store migrations directory (tests only). */
  readonly sessionMigrationsDir?: string
}

export interface AuthStore {
  createPairingToken(): { token: string; expiresAt: number }
  consumePairingToken(token: string, client: PairedClientInfo): BootstrapResult | null
  /**
   * Mint a session without going through the pairing flow. Used by the
   * embedded + subprocess shells to issue a session for the locally-running
   * main window + tray window.
   */
  createLocalSession(client: PairedClientInfo): BootstrapResult
  validateSession(sessionToken: string): { sessionId: string; expiresAt: number; role: SessionRole } | null
  issueWsToken(sessionToken: string): WsTokenResult | null
  consumeWsToken(wsToken: string): { sessionId: string } | null
  revokeSession(sessionId: string): boolean
  listSessions(): PairedSessionSummary[]
  /**
   * Access to the underlying SessionStore — used by @wanda/gateway (once
   * adopted) which consumes a GatewaySessionBackend directly.
   */
  readonly sessions: SessionStore
}

function encodeDeviceLabel(info: PairedClientInfo): string {
  return JSON.stringify(info)
}

function decodeDeviceLabel(raw: string): PairedClientInfo {
  try {
    const parsed = JSON.parse(raw) as Partial<PairedClientInfo>
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.deviceName === 'string' &&
      typeof parsed.os === 'string' &&
      typeof parsed.appVersion === 'string'
    ) {
      return { deviceName: parsed.deviceName, os: parsed.os, appVersion: parsed.appVersion }
    }
  } catch {
    /* fall through */
  }
  return { deviceName: raw, os: 'unknown', appVersion: 'unknown' }
}

export function createInMemoryAuthStore(serverId: string, options: AuthStoreOptions = {}): AuthStore {
  const pairingTtl = options.pairingTokenTtlMs ?? DEFAULT_PAIRING_TTL_MS
  const sessionTtl = options.sessionTokenTtlMs ?? DEFAULT_SESSION_TTL_MS
  const wsTtl = options.wsTokenTtlMs ?? DEFAULT_WS_TOKEN_TTL_MS

  const rawSqlite = options.db ? options.db.$client : new Database(':memory:')
  const ownsDb = options.db === undefined
  const sessions = new SessionStore(rawSqlite, {
    ownsDb,
    sessionLifetimeMs: sessionTtl,
    wsTokenLifetimeMs: wsTtl,
    migrationsDir: options.sessionMigrationsDir,
  })

  const pairings = new Map<string, PairingRecord>()

  const now = (): number => Date.now()

  function pruneExpiredPairings(): void {
    const t = now()
    for (const [k, rec] of pairings) {
      if (rec.expiresAt <= t) pairings.delete(k)
    }
  }

  function mintSession(client: PairedClientInfo, role: SessionRole): BootstrapResult {
    const session = sessions.createSession({
      clientId: `paired-${randomUUID()}`,
      deviceLabel: encodeDeviceLabel(client),
    })
    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      serverId,
      role,
      expiresAt: session.expiresAt,
    }
  }

  return {
    sessions,

    createPairingToken() {
      pruneExpiredPairings()
      const token = cryptoRandomBytes(32).toString('hex')
      const expiresAt = now() + pairingTtl
      pairings.set(token, { token, expiresAt })
      return { token, expiresAt }
    },

    consumePairingToken(token, client) {
      pruneExpiredPairings()
      const rec = pairings.get(token)
      if (!rec) return null
      // Single-use: burn regardless of what happens below.
      pairings.delete(token)
      if (rec.expiresAt <= now()) return null
      return mintSession(client, PAIRED_CLIENT_ROLE)
    },

    createLocalSession(client) {
      // Local shell sessions use a stable clientId per host+device so
      // repeated boots replace the previous row rather than accumulating.
      const clientId = `local-shell:${client.deviceName}`
      const session = sessions.createSession({
        clientId,
        deviceLabel: encodeDeviceLabel(client),
      })
      return {
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        serverId,
        role: LOCAL_SHELL_ROLE,
        expiresAt: session.expiresAt,
      }
    },

    validateSession(sessionToken) {
      const session = sessions.findByToken(sessionToken)
      if (!session) return null
      if (now() >= session.expiresAt) {
        sessions.revoke(session.sessionId)
        return null
      }
      return {
        sessionId: session.sessionId,
        expiresAt: session.expiresAt,
        role: LOCAL_SHELL_ROLE,
      }
    },

    issueWsToken(sessionToken) {
      const session = sessions.findByToken(sessionToken)
      if (!session) return null
      if (now() >= session.expiresAt) return null
      try {
        const grant = sessions.issueWsToken(session.sessionId)
        return { wsToken: grant.wsToken, expiresAt: grant.expiresAt }
      } catch (err) {
        log.main.warn('auth: issueWsToken failed:', err)
        return null
      }
    },

    consumeWsToken(wsToken) {
      const result = sessions.consumeWsToken(wsToken)
      if (!result.ok) return null
      return { sessionId: result.sessionId }
    },

    revokeSession(sessionId) {
      return sessions.revoke(sessionId)
    },

    listSessions() {
      return sessions.list().map((s) => ({
        sessionId: s.sessionId,
        device: decodeDeviceLabel(s.deviceLabel),
        role: LOCAL_SHELL_ROLE,
        issuedAt: s.createdAt,
        expiresAt: s.expiresAt,
      }))
    },
  }
}

// -----------------------------------------------------------------------------
// HTTP surface
// -----------------------------------------------------------------------------

export interface AuthHttpHandlerOpts {
  readonly store: AuthStore
  readonly capabilities: ServerCapabilities
}

/**
 * Returns a handler that responds to /api/auth/* and /api/capabilities.
 * Returns `true` if the request was handled, `false` otherwise — the caller
 * (the server's main HTTP handler) can then fall through to its default.
 */
export function createAuthHttpHandler(
  opts: AuthHttpHandlerOpts,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  const { store, capabilities } = opts

  async function readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        if (chunks.length === 0) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')))
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  function writeJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  function bearer(req: IncomingMessage): string | null {
    const auth = req.headers.authorization
    if (!auth) return null
    const parts = auth.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') return null
    return parts[1] ?? null
  }

  return async function handle(req, res) {
    const url = req.url ?? '/'

    if (url === '/api/auth/bootstrap' && req.method === 'POST') {
      let body: unknown
      try {
        body = await readJson(req)
      } catch {
        writeJson(res, 400, { error: 'invalid-json' })
        return true
      }
      const { pairingToken, client } = (body ?? {}) as {
        pairingToken?: unknown
        client?: Partial<PairedClientInfo>
      }
      if (
        typeof pairingToken !== 'string' ||
        !client ||
        typeof client.deviceName !== 'string' ||
        typeof client.os !== 'string' ||
        typeof client.appVersion !== 'string'
      ) {
        writeJson(res, 400, { error: 'invalid-body' })
        return true
      }
      const result = store.consumePairingToken(pairingToken, client as PairedClientInfo)
      if (!result) {
        writeJson(res, 401, { error: 'invalid-or-expired-pairing-token' })
        return true
      }
      log.main.debug(`auth: paired device "${client.deviceName}" (session ${result.sessionId.slice(0, 8)}…)`)
      writeJson(res, 200, result)
      return true
    }

    if (url === '/api/auth/ws-token' && req.method === 'POST') {
      const token = bearer(req)
      if (!token) {
        writeJson(res, 401, { error: 'missing-bearer' })
        return true
      }
      const result = store.issueWsToken(token)
      if (!result) {
        writeJson(res, 401, { error: 'invalid-session' })
        return true
      }
      writeJson(res, 200, result)
      return true
    }

    if (url === '/api/capabilities' && req.method === 'GET') {
      const token = bearer(req)
      if (!token || !store.validateSession(token)) {
        writeJson(res, 401, { error: 'invalid-session' })
        return true
      }
      writeJson(res, 200, capabilities)
      return true
    }

    return false
  }
}
