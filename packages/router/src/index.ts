// -----------------------------------------------------------------------------
// @wanda/router — paired-server registry, outbox, idempotency keys.
// -----------------------------------------------------------------------------

export {
  MigrationError,
  OutboxEntryNotFoundError,
  ServerNotFoundError,
} from './errors.ts'
export { IDEMPOTENCY_VERSION, makeIdempotencyKey } from './idempotency-key.ts'
export type { Migration } from './migrations.ts'
export {
  currentSchemaVersion,
  defaultMigrationsDir,
  loadMigrations,
  ROUTER_SCHEMA_VERSION_KEY,
  runMigrations,
} from './migrations.ts'
export type { OutboxOptions } from './outbox.ts'
export { Outbox } from './outbox.ts'
export type { ServerRegistryOptions } from './server-registry.ts'
export { ServerRegistry } from './server-registry.ts'
export type { Mutation, OutboxEntry, PairedServer } from './types.ts'
