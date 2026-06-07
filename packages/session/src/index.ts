// -----------------------------------------------------------------------------
// @wanda/session — server identity, long-lived sessions, wsTokens, grace window.
// -----------------------------------------------------------------------------

export { crc32Of } from './crc.ts'
export {
  MigrationError,
  ServerIdentityCorruptedError,
  SessionExpiredError,
  SessionNotFoundError,
} from './errors.ts'
export type { Migration } from './migrations.ts'
export {
  currentSchemaVersion,
  defaultMigrationsDir,
  loadMigrations,
  runMigrations,
  SESSION_SCHEMA_VERSION_KEY,
} from './migrations.ts'
export { openSessionStore, SessionStore } from './session-store.ts'
export type {
  ConsumedWsToken,
  GraceState,
  ServerIdentity,
  Session,
  SessionStoreConfig,
  WsTokenGrant,
} from './types.ts'
