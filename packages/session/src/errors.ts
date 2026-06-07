// -----------------------------------------------------------------------------
// Errors specific to @wanda/session.
// -----------------------------------------------------------------------------

export class ServerIdentityCorruptedError extends Error {
  readonly storedEpoch: number
  readonly storedCrc: number
  readonly expectedCrc: number
  constructor(storedEpoch: number, storedCrc: number, expectedCrc: number) {
    super(
      `server identity CRC mismatch: stored epoch=${storedEpoch}, crc=${storedCrc}, expected=${expectedCrc}. ` +
        `The server identity row is corrupted. Manual intervention required: ` +
        `DELETE FROM server_identity (will force all paired clients to re-pair).`,
    )
    this.name = 'ServerIdentityCorruptedError'
    this.storedEpoch = storedEpoch
    this.storedCrc = storedCrc
    this.expectedCrc = expectedCrc
  }
}

export class SessionNotFoundError extends Error {
  constructor(selector: string) {
    super(`session not found: ${selector}`)
    this.name = 'SessionNotFoundError'
  }
}

export class SessionExpiredError extends Error {
  constructor(sessionId: string) {
    super(`session expired: ${sessionId}`)
    this.name = 'SessionExpiredError'
  }
}

export class MigrationError extends Error {
  readonly migrationId: string
  constructor(migrationId: string, message: string) {
    super(`session-store migration ${migrationId} failed: ${message}`)
    this.name = 'MigrationError'
    this.migrationId = migrationId
  }
}
