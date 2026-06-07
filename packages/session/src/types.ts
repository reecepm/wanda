// -----------------------------------------------------------------------------
// Public types for @wanda/session.
// -----------------------------------------------------------------------------

/** The server's stable identity row. One per install. */
export interface ServerIdentity {
  readonly id: string
  readonly epoch: number
  readonly createdAt: number
}

/** A paired client's long-lived session. */
export interface Session {
  readonly sessionId: string
  readonly clientId: string
  readonly sessionToken: string
  readonly deviceLabel: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly lastSeenAt: number
}

/** One-shot, short-lived token used to authorize a WS upgrade. */
export interface WsTokenGrant {
  readonly wsToken: string
  readonly expiresAt: number
}

/** Result of consuming a wsToken. */
export type ConsumedWsToken =
  | { readonly ok: true; readonly sessionId: string; readonly clientId: string }
  | { readonly ok: false; readonly reason: 'not-found' | 'expired' | 'already-consumed' }

/** Configuration for a new SessionStore. */
export interface SessionStoreConfig {
  /** Defaults to Date.now. */
  readonly now?: () => number
  /** How long a sessionToken remains valid. Default 30d. */
  readonly sessionLifetimeMs?: number
  /** wsToken TTL. Default 30s. */
  readonly wsTokenLifetimeMs?: number
  /** Grace window for WS-disconnect → resume. Default 10s. */
  readonly graceWindowMs?: number
  /** Random-byte generator (test override). Default node:crypto. */
  readonly randomBytes?: (size: number) => Buffer
  /** Override for tests. */
  readonly migrationsDir?: string
}

/** Disconnect / grace-window state, kept in-memory. */
export interface GraceState {
  readonly sessionId: string
  readonly disconnectedAt: number
}
