// -----------------------------------------------------------------------------
// Runtime validators for Codex response shapes that the provider actually
// extracts fields from.
//
// These are the moral equivalent of what a full openai/codex schema
// codegen pipeline (t3 gold-standard) would emit, scoped down to the
// methods whose *result fields* we read. Methods whose result we only
// acknowledge (e.g. `initialized`, `turn/interrupt`) don't need schemas.
//
// When the Codex server drifts — a field is renamed, a type changes —
// these parsers surface a typed error at the RPC boundary instead of
// leaving the provider to crash later with an opaque `undefined` access.
// Paired with the hand-rolled TypeScript types in `protocol.ts` (which
// guard outgoing payloads at compile time) this closes the "we send
// well-typed requests, they send us anything" asymmetry.
// -----------------------------------------------------------------------------

import { z } from 'zod'

/**
 * `thread/start` / `thread/resume` response — Codex 0.104+ nests the
 * thread metadata under `thread`. We only extract `thread.id`; everything
 * else flows back to caller as opaque extra fields.
 */
export const ThreadStartResponseSchema = z
  .object({
    thread: z
      .object({
        id: z.string().min(1, 'thread.id must be a non-empty string'),
      })
      .passthrough(),
  })
  .passthrough()

export const ThreadResumeResponseSchema = ThreadStartResponseSchema

/**
 * `model/list` — current Codex v2 returns `{ data: Model[] }`; older
 * generated clients/tests used `{ models: Model[] }`. Accept both.
 */
const CodexModelEntrySchema = z
  .object({
    id: z.string().min(1),
    model: z.string().optional(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    hidden: z.boolean().optional(),
    inputModalities: z.array(z.string()).optional(),
    isDefault: z.boolean().optional(),
    supportedReasoningEfforts: z
      .array(z.union([z.string(), z.object({ reasoningEffort: z.string().optional() }).passthrough()]))
      .optional(),
    defaultReasoningEffort: z.string().optional(),
  })
  .passthrough()

export const ModelListResponseSchema = z
  .object({
    data: z.array(CodexModelEntrySchema).optional(),
    models: z.array(CodexModelEntrySchema).optional(),
    nextCursor: z.string().nullable().optional(),
  })
  .passthrough()

/**
 * `collaborationMode/list` — we only branch on presence of a mode whose
 * name includes "plan" to set `supportsPlanMode`. Shape check stays lax.
 */
export const CollaborationModeListResponseSchema = z
  .object({
    collaborationModes: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string().optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough()

/**
 * `initialize` — result shape is ignored by callers today (we just need
 * the handshake to succeed), but parse it so a totally-absent response
 * surfaces as a drift error rather than passing silently.
 */
export const InitializeResponseSchema = z
  .object({
    userAgent: z.string().optional(),
    codexHome: z.string().optional(),
    platformFamily: z.string().optional(),
    platformOs: z.string().optional(),
  })
  .passthrough()
