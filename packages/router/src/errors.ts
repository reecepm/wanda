export class MigrationError extends Error {
  readonly migrationId: string
  constructor(migrationId: string, message: string) {
    super(`router migration ${migrationId} failed: ${message}`)
    this.name = 'MigrationError'
    this.migrationId = migrationId
  }
}

export class OutboxEntryNotFoundError extends Error {
  constructor(id: string) {
    super(`outbox entry not found: ${id}`)
    this.name = 'OutboxEntryNotFoundError'
  }
}

export class ServerNotFoundError extends Error {
  constructor(selector: string) {
    super(`paired server not found: ${selector}`)
    this.name = 'ServerNotFoundError'
  }
}
