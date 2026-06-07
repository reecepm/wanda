// -----------------------------------------------------------------------------
// AgentEvent schema versioning.
//
// Additive changes (new optional field, new variant with a new `kind`)
// do not bump CURRENT_EVENT_SCHEMA_VERSION. Breaking changes do, and require
// a migration path for older rows in `@wanda/event-log`.
// -----------------------------------------------------------------------------

export const CURRENT_EVENT_SCHEMA_VERSION = 1 as const

/**
 * Minimum schema version the current binary will attempt to read. Anything
 * older surfaces as a "migration required" banner in the UI; events are not
 * replayed. Bumped together with a migration script.
 */
export const MIN_READ_SCHEMA_VERSION = 1 as const

export function isSupportedSchemaVersion(v: number): boolean {
  return v >= MIN_READ_SCHEMA_VERSION && v <= CURRENT_EVENT_SCHEMA_VERSION
}
