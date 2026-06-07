// -----------------------------------------------------------------------------
// Shared tagged-error convention for the server runtime.
//
// Backend Effects fail with tagged errors instead of throwing, so every method's
// error channel is honest (`E` is a union of these, not `never`). Each error is a
// plain `Data.TaggedError` — yieldable and discriminable on `_tag`
// (`Effect.catchTag('NotFoundError', …)`) — that *also* carries an oRPC `code`.
//
// `AppError` stamps each instance with `effect-orpc`'s `ORPCErrorSymbol`, so the
// boundary in `effect-orpc`'s `.effect()` runner (its `onFail` → `isORPCTaggedError`
// branch) recognizes the failure and converts it to a real `ORPCError` for the
// client with no per-handler wiring. Adopters get a meaningful code + message the
// moment they `Effect.fail` with one of these, instead of a generic 500.
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/server'
import type { Cause } from 'effect'
import { Data } from 'effect'
import { ORPCErrorSymbol } from 'effect-orpc'

type ORPCErrorCode = ConstructorParameters<typeof ORPCError>[0]

/** Fields every `AppError` accepts on top of its own data. */
interface AppErrorData {
  /** Client-facing message; defaults to the oRPC code's standard text. */
  readonly message?: string
  /** Server-only diagnostic; logged but never serialized to the client. */
  readonly cause?: unknown
}

/** Members `AppError` stamps onto every instance so the oRPC boundary can map it. */
interface AppErrorShape<Tag extends string, Code extends ORPCErrorCode> {
  readonly _tag: Tag
  readonly code: Code
  readonly [ORPCErrorSymbol]: ORPCError<Code, undefined>
  toORPCError(): ORPCError<Code, undefined>
}

/** Constructor preserving `Data.TaggedError`'s open data generic plus our members. */
interface AppErrorClass<Tag extends string, Code extends ORPCErrorCode> {
  new <A extends Record<string, unknown> = Record<never, never>>(
    args: AppErrorData & { readonly [P in keyof A as P extends '_tag' ? never : P]: A[P] },
  ): Cause.YieldableError & AppErrorShape<Tag, Code> & Readonly<AppErrorData> & Readonly<A>
}

/**
 * Base for application tagged errors. Defining one:
 *
 * ```ts
 * export class WorkspaceNotFound extends AppError('WorkspaceNotFound', 'NOT_FOUND')<{
 *   readonly workspaceId: string
 * }> {}
 *
 * yield* new WorkspaceNotFound({ workspaceId, message: `workspace ${workspaceId} not found` })
 * ```
 *
 * The instance discriminates on `_tag`, yields in Effect generators, and surfaces
 * to the client as an `ORPCError` carrying `code` — no boundary mapping needed.
 */
export function AppError<const Tag extends string, const Code extends ORPCErrorCode>(
  tag: Tag,
  code: Code,
): AppErrorClass<Tag, Code> {
  class Base extends Data.TaggedError(tag)<AppErrorData> {
    readonly code: Code = code

    get [ORPCErrorSymbol](): ORPCError<Code, undefined> {
      return new ORPCError(code, { message: this.message, cause: this.cause })
    }

    toORPCError(): ORPCError<Code, undefined> {
      return this[ORPCErrorSymbol]
    }
  }
  return Base as unknown as AppErrorClass<Tag, Code>
}

// --- Broadly reusable errors -------------------------------------------------

/** The requested entity does not exist. Maps to HTTP 404. */
export class NotFoundError extends AppError('NotFoundError', 'NOT_FOUND')<{
  readonly resource: string
  readonly id?: string
}> {}

/** Input is structurally valid but violates a domain rule. Maps to HTTP 422. */
export class ValidationError extends AppError('ValidationError', 'UNPROCESSABLE_CONTENT')<{
  readonly field?: string
}> {}

/** The operation conflicts with current state (e.g. a duplicate). Maps to HTTP 409. */
export class ConflictError extends AppError('ConflictError', 'CONFLICT')<{
  readonly resource?: string
}> {}

/** An unexpected server-side failure. Maps to HTTP 500. */
export class InternalError extends AppError('InternalError', 'INTERNAL_SERVER_ERROR')<Record<never, never>> {}
