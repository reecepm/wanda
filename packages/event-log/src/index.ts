// -----------------------------------------------------------------------------
// @wanda/event-log — durable sequenced event log backed by SQLite.
// -----------------------------------------------------------------------------

export type { ReplayGoneReason } from './errors.ts'
export {
  EventLogClosedError,
  EventLogReadOnlyError,
  isDiskFullError,
  MigrationError,
  ReplayGoneError,
} from './errors.ts'
export type { EventLogOptions } from './event-log.ts'
export { EventLog, openEventLog } from './event-log.ts'
export type { Migration } from './migrations.ts'

export {
  CURRENT_SCHEMA_VERSION_KEY,
  currentSchemaVersion,
  defaultMigrationsDir,
  loadMigrations,
  runMigrations,
} from './migrations.ts'
export type {
  DeleteByResourceResult,
  EventLogHealth,
  EventRecord,
  HealthListener,
  PruneOptions,
  PublishBatchInput,
  ReplayPageByResourceOptions,
  ReplayPageResult,
} from './types.ts'
