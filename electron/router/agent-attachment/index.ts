// -----------------------------------------------------------------------------
// `agent.attachment.*` oRPC procedures.
//
// Upload accepts bytes + metadata and returns an `AttachmentRef`-shaped
// result the client stuffs into the next prompt. Download goes through the
// HTTP endpoint (`/attachments/:id`) — no oRPC blob transport.
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/client'
import type { AttachmentId, SessionId } from '@wanda/agent-protocol'
import { Effect } from 'effect'
import { z } from 'zod'
import { AgentAttachmentService } from '../../domains/agent-attachment'
import type { AppRouterDeps } from '../index'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MiB

// Zod doesn't validate Uint8Array directly across JSON RPC because the
// wire transport encodes it; oRPC accepts `z.instanceof(Uint8Array)`.
const sessionIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as SessionId)
const attachmentIdSchema = z
  .string()
  .min(1)
  .transform((value) => value as AttachmentId)

const UploadInputSchema = z.object({
  bytes: z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_UPLOAD_BYTES, {
    message: `Attachment must be between 1 B and ${MAX_UPLOAD_BYTES} B`,
  }),
  mediaType: z.string().min(1).max(255),
  /** Optional best-effort original filename (null for pasted blobs). */
  name: z.string().min(1).max(512).optional(),
  /** Optional session binding at upload time. Usually set on prompt. */
  sessionId: sessionIdSchema.optional(),
})

const MetaInputSchema = z.object({ attachmentId: attachmentIdSchema })

export function agentAttachmentRoutes({ effectOs }: AppRouterDeps) {
  return {
    upload: effectOs.input(UploadInputSchema).effect(function* ({ input }) {
      const svc = yield* AgentAttachmentService
      const row = yield* svc
        .upload({
          bytes: input.bytes,
          mimeType: input.mediaType,
          originalFilename: input.name ?? null,
          sessionId: input.sessionId ?? null,
          source: 'user',
        })
        .pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new ORPCError('INTERNAL_SERVER_ERROR', {
                message: err.message || 'Attachment upload failed',
                cause: err,
              }),
            ),
          ),
        )
      return {
        id: row.id,
        sha256: row.sha256,
        mediaType: row.mimeType,
        size: row.byteSize,
        name: row.originalFilename,
      }
    }),

    meta: effectOs.input(MetaInputSchema).effect(function* ({ input }) {
      const svc = yield* AgentAttachmentService
      const row = yield* svc.findById(input.attachmentId)
      if (!row) {
        return yield* Effect.fail(new ORPCError('NOT_FOUND', { message: `Attachment ${input.attachmentId} not found` }))
      }
      return {
        id: row.id,
        sha256: row.sha256,
        mediaType: row.mimeType,
        size: row.byteSize,
        name: row.originalFilename,
        sessionId: row.sessionId,
        createdAt: row.createdAt,
      }
    }),
  }
}
