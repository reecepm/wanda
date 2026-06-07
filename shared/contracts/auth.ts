// -----------------------------------------------------------------------------
// Auth / pairing contracts.
//
// The pairing flow uses a short-lived, single-use pairing token to bootstrap
// a long-lived session token. Session tokens issue one-shot WS tokens for
// authenticated WebSocket upgrades.
// -----------------------------------------------------------------------------

export interface PairedClientInfo {
  readonly deviceName: string
  readonly os: string
  readonly appVersion: string
}

export interface BootstrapRequest {
  readonly pairingToken: string
  readonly client: PairedClientInfo
}

export type SessionRole = 'owner' | 'client'

export interface BootstrapResult {
  readonly sessionToken: string
  readonly sessionId: string
  readonly serverId: string
  readonly role: SessionRole
  /** Epoch millis at which this session expires. */
  readonly expiresAt: number
}

export interface WsTokenResult {
  readonly wsToken: string
  /** Epoch millis. Typically now + 30s. */
  readonly expiresAt: number
}

export interface PairedSessionSummary {
  readonly sessionId: string
  readonly device: PairedClientInfo
  readonly role: SessionRole
  readonly issuedAt: number
  readonly expiresAt: number
}
