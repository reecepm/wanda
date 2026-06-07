// -----------------------------------------------------------------------------
// AgentAttachmentService — owns the `agent_attachments` metadata rows and
// the on-disk blob store. Upload dedups by sha256 at the row level; blobs
// are content-addressed so the underlying file is written once per sha
// regardless of how many sessions reference it.
//
// Configure via `configureAttachmentService({ baseDir })` from the server
// entry BEFORE the AppLayer resolves (same pattern as `configureDatabase`).
// -----------------------------------------------------------------------------

import type { AttachmentId, SessionId } from '@wanda/agent-protocol'
import { newAttachmentId } from '@wanda/agent-protocol'
import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../infra/database'
import {
  type AttachmentRow,
  bindAttachmentToSession,
  ensureAttachmentBoundToSession,
  findAttachmentById,
  findBySessionSha,
  insertAttachment,
} from './repository'
import { readBlobStream, statBlob, writeBlob } from './storage'

interface UploadInput {
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly originalFilename?: string | null
  readonly sessionId?: SessionId | null
  readonly source?: 'user' | 'agent'
}

interface AgentAttachmentServiceShape {
  /**
   * Upload bytes. Dedups by sha256 within the target session (or the null-
   * session cohort for pre-bind uploads): re-uploading the same bytes for
   * the same session returns the existing row's id without a rewrite.
   */
  readonly upload: (input: UploadInput) => Effect.Effect<AttachmentRow, Error>
  readonly findById: (id: AttachmentId) => Effect.Effect<AttachmentRow | null>
  /**
   * Bind an unbound attachment to a session. No-op if the row is already
   * bound to the same session; fails silently if bound elsewhere (caller
   * should have already rejected via `validateForSession`).
   */
  readonly bindToSession: (id: AttachmentId, sessionId: SessionId, turnId?: string) => Effect.Effect<void>
  /**
   * Atomic bind-or-check: if the row is unbound, bind it to `sessionId`;
   * if already bound to `sessionId`, no-op. Returns `true` in either case,
   * `false` otherwise (row missing or bound to a different session). Use
   * this from request paths that must reject cross-session attachment
   * sharing — the single UPDATE eliminates the read-then-write TOCTOU.
   */
  readonly ensureBoundToSession: (id: AttachmentId, sessionId: SessionId, turnId?: string) => Effect.Effect<boolean>
  /**
   * Return the row iff it is readable in the context of the given session
   * (bound to it, or unbound). Used by the HTTP blob endpoint to gate
   * access without exposing other users' attachments.
   */
  readonly findReadable: (id: AttachmentId, sessionId: SessionId | null) => Effect.Effect<AttachmentRow | null>
  /** Open a read stream for the blob behind an already-looked-up row. */
  readonly readStream: (row: AttachmentRow) => Effect.Effect<NodeJS.ReadableStream>
  /** Confirm the on-disk blob matches the row's byteSize. Returns null if missing. */
  readonly verifyBlob: (row: AttachmentRow) => Effect.Effect<number | null>
}

export class AgentAttachmentService extends Context.Tag('AgentAttachmentService')<
  AgentAttachmentService,
  AgentAttachmentServiceShape
>() {}

// --- Configuration singleton -------------------------------------------------

interface AttachmentConfig {
  readonly baseDir: string
}
let config: AttachmentConfig | null = null

/** Supply the blob base directory. Must be called before the AppLayer resolves. */
export function configureAttachmentService(input: AttachmentConfig): void {
  config = input
}

export function hasAttachmentConfig(): boolean {
  return config !== null
}

export function getAttachmentBaseDir(): string {
  if (!config) {
    throw new Error('configureAttachmentService() must be called before reading the attachment base directory.')
  }
  return config.baseDir
}

// --- Live layer --------------------------------------------------------------

export const AgentAttachmentServiceLive = Layer.effect(
  AgentAttachmentService,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      upload: (input) =>
        Effect.gen(function* () {
          const baseDir = getAttachmentBaseDir()
          const write = yield* Effect.tryPromise({
            try: () => writeBlob(baseDir, input.bytes),
            catch: (err) => (err instanceof Error ? err : new Error(`attachment write failed: ${String(err)}`)),
          })

          // Dedup window keyed by (sessionId, sha256). A NULL sessionId has
          // its own cohort so two anonymous uploads with identical bytes
          // still dedup to the same row.
          const sessionId = input.sessionId ?? null
          const existing = yield* Effect.sync(() => findBySessionSha(db, { sessionId, sha256: write.sha256 }))
          if (existing) return existing

          const id = newAttachmentId()
          const createdAt = new Date()
          const originalFilename = input.originalFilename ?? null
          const source = input.source ?? 'user'
          const insert = yield* Effect.try({
            try: () =>
              insertAttachment(db, {
                id,
                sessionId,
                mimeType: input.mimeType,
                byteSize: write.bytes,
                sha256: write.sha256,
                originalFilename,
                source,
                createdAt,
              }),
            catch: (err) =>
              err instanceof Error ? err : new Error(`attachment metadata insert failed: ${String(err)}`),
          }).pipe(Effect.either)

          if (insert._tag === 'Left') {
            const raced = yield* Effect.sync(() => findBySessionSha(db, { sessionId, sha256: write.sha256 }))
            if (raced) return raced
            return yield* Effect.fail(insert.left)
          }

          return {
            id,
            sessionId,
            mimeType: input.mimeType,
            byteSize: write.bytes,
            sha256: write.sha256,
            originalFilename,
            source,
            firstReferencedTurnId: null,
            createdAt: createdAt.getTime(),
          }
        }),

      findById: (id) => Effect.sync(() => findAttachmentById(db, id)),

      bindToSession: (id, sessionId, turnId) =>
        Effect.sync(() =>
          bindAttachmentToSession(db, {
            id,
            sessionId,
            turnId,
          }),
        ),

      ensureBoundToSession: (id, sessionId, turnId) =>
        Effect.sync(() =>
          ensureAttachmentBoundToSession(db, {
            id,
            sessionId,
            turnId,
          }),
        ),

      findReadable: (id, sessionId) =>
        Effect.sync(() => {
          const row = findAttachmentById(db, id)
          if (!row) return null
          // Unbound rows are readable by any authenticated caller (upload
          // owner); bound rows require the session to match.
          if (row.sessionId != null && row.sessionId !== sessionId) {
            return null
          }
          return row
        }),

      readStream: (row) => Effect.sync(() => readBlobStream(getAttachmentBaseDir(), row.sha256)),

      verifyBlob: (row) =>
        Effect.tryPromise({
          try: () => statBlob(getAttachmentBaseDir(), row.sha256),
          catch: () => null,
        }).pipe(Effect.orElseSucceed(() => null)),
    }
  }),
)
