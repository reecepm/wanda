// -----------------------------------------------------------------------------
// jsonColumn — a Drizzle TEXT column that validates its JSON payload with a
// zod schema on every read.
//
// Plain `text(name, { mode: 'json' }).$type<T>()` is a compile-time-only cast:
// Drizzle JSON.parses the stored string and hands it back as `T` without ever
// checking it. A row written by an older schema, hand-edited, or corrupted then
// flows through the app as a lie. `jsonColumn` closes that gap by running
// `schema.safeParse` in the driver's read hook and surfacing a typed
// `JsonColumnError` (never a silent bad cast) when the payload is malformed.
//
// The emitted SQL type stays `text`, so a column declared with `jsonColumn` is
// DDL-identical to the `text(..., { mode: 'json' })` it replaces — no migration
// is needed to adopt it.
//
// For call sites that would rather branch on malformed data than catch a throw,
// `parseJsonColumn` returns the same typed result shape used by the workenv
// controller (a zod `safeParse`-style discriminated union).
// -----------------------------------------------------------------------------

import { customType } from 'drizzle-orm/sqlite-core'
import type { z } from 'zod'

export class JsonColumnError extends Error {
  readonly _tag = 'JsonColumnError'
  readonly column: string
  readonly issues: readonly z.core.$ZodIssue[]

  constructor(column: string, issues: readonly z.core.$ZodIssue[]) {
    const first = issues[0]
    const where = first && first.path.length > 0 ? ` at ${first.path.join('.')}` : ''
    super(`json column "${column}"${where}: ${first?.message ?? 'invalid payload'}`)
    this.name = 'JsonColumnError'
    this.column = column
    this.issues = issues
  }
}

export type JsonColumnParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: JsonColumnError }

/**
 * Validate a raw stored JSON column value against `schema`, returning a typed
 * result instead of throwing. Mirrors the workenv controller's read-time
 * `safeParse` handling for call sites that surface malformed data as a value.
 */
export function parseJsonColumn<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  column = 'json',
): JsonColumnParseResult<z.output<S>> {
  const result = schema.safeParse(typeof raw === 'string' ? safeJsonParse(raw) : raw)
  if (!result.success) {
    return { ok: false, error: new JsonColumnError(column, result.error.issues) }
  }
  return { ok: true, value: result.data }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * A validated JSON TEXT column. Declare it like any other Drizzle column:
 *
 *   config: jsonColumn('config', workenvConfigSchema).notNull()
 *
 * On read, the stored JSON is parsed and validated against `schema`; a
 * `JsonColumnError` is thrown when it does not match. On write, the value is
 * validated and re-serialized, so malformed data can never reach the database
 * either. Chain `.notNull()`, `.default(...)`, `.$type<...>()`, etc. exactly as
 * with `text(...)`.
 */
export function jsonColumn<S extends z.ZodType>(name: string, schema: S) {
  return customType<{ data: z.output<S>; driverData: string }>({
    dataType() {
      return 'text'
    },
    toDriver(value) {
      const result = schema.safeParse(value)
      if (!result.success) {
        throw new JsonColumnError(name, result.error.issues)
      }
      return JSON.stringify(result.data)
    },
    fromDriver(raw) {
      const result = schema.safeParse(safeJsonParse(raw))
      if (!result.success) {
        throw new JsonColumnError(name, result.error.issues)
      }
      return result.data
    },
  })(name)
}
