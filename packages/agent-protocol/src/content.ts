// -----------------------------------------------------------------------------
// Prompt content + attachment refs.
//
// Attachments are content-addressed. Blob lives at
// `<userData>/attachments/<sha256[0:2]>/<sha256>.bin`; event payloads carry
// only a compact ref. See 00-index R4/R5/R6.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { AttachmentIdSchema } from './ids.ts'

export const MediaTypeSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\w.+-]+\/[\w.+-]+$/, 'invalid media type')

/** Lowercase hex sha256 (64 chars). */
export const Sha256Schema = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/, 'sha256 must be lowercase hex')

/** Reference to a blob stored in the content-addressed attachment store. */
export const AttachmentRefSchema = z.object({
  kind: z.literal('attachment'),
  id: AttachmentIdSchema,
  mediaType: MediaTypeSchema,
  size: z.number().int().min(0),
  sha256: Sha256Schema,
  /** Original filename; optional. */
  name: z.string().max(512).optional(),
})
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>

/** Image-specific attachment with extra dims for layout. */
export const ImageRefSchema = z.object({
  kind: z.literal('image'),
  id: AttachmentIdSchema,
  mediaType: MediaTypeSchema,
  size: z.number().int().min(0),
  sha256: Sha256Schema,
  name: z.string().max(512).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})
export type ImageRef = z.infer<typeof ImageRefSchema>

/** Reference to a workspace resource (file, terminal, agent session, etc.). */
export const ResourceLinkSchema = z.object({
  kind: z.literal('resource'),
  /** Wanda ResourceRef shape; schema is permissive to avoid a cycle with wire. */
  ref: z.object({
    serverId: z.string().min(1),
    kind: z.string().min(1),
    id: z.string().min(1),
  }),
  title: z.string().max(512).optional(),
})
export type ResourceLink = z.infer<typeof ResourceLinkSchema>

/** A single block inside a user prompt. */
export const PromptBlockSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().max(1_000_000),
  }),
  AttachmentRefSchema,
  ImageRefSchema,
  ResourceLinkSchema,
  z.object({
    kind: z.literal('mention'),
    mentionType: z.enum(['user', 'agent', 'file', 'symbol', 'url']),
    label: z.string().min(1).max(512),
    target: z.string().min(1).max(4096),
  }),
  z.object({
    kind: z.literal('command'),
    name: z.string().min(1).max(128),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
])
export type PromptBlock = z.infer<typeof PromptBlockSchema>
