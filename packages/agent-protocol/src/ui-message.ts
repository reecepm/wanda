// -----------------------------------------------------------------------------
// Renderer-side UIMessage + Part union.
//
// Isomorphic to the Vercel AI SDK's UIMessage so `useChat` could drop in
// later; never touches the wire. The reducer in `@wanda/agent-store`
// projects AgentEvent → UIMessage.
//
// `data-${string}` template literals can't be discriminator literals in
// `z.discriminatedUnion`, so custom parts use `{ type: 'data', name, ... }`
// (see 00-index amendment A3 / 01 §A7). Every part carries a stable `index`
// so the reducer can keep ordering during streaming reshuffles.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { AttachmentRefSchema, ImageRefSchema } from './content.ts'
import { MessageIdSchema, QuestionIdSchema, RequestIdSchema, ToolCallIdSchema } from './ids.ts'
import { DecisionSchema, PermissionRequestSchema, QuestionAnswerSchema, QuestionOptionSchema } from './permission.ts'
import { PlanItemSchema } from './plan.ts'
import { FileLocationSchema, ToolCallDetailSchema } from './tool-detail.ts'
import type { ToolKind } from './tool-kind.ts'

const AttachmentOrImageRefSchema = z.discriminatedUnion('kind', [AttachmentRefSchema, ImageRefSchema])

export const StopReasonSchema = z.enum(['end_turn', 'max_tokens', 'tool_use', 'cancelled', 'error', 'other'])
export type StopReason = z.infer<typeof StopReasonSchema>

const PartStateSchema = z.enum(['streaming', 'done'])

/** Stable ordinal inside the parent UIMessage. */
const indexShape = { index: z.number().int().min(0) }

const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  state: PartStateSchema,
  /**
   * Attachments emitted alongside the text (currently user-role only). Each
   * entry is a content-addressed ref; the renderer derives the fetch URL
   * via the transport's `attachmentUrl` + `attachmentAuthHeaders`.
   */
  attachments: z.array(AttachmentOrImageRefSchema).optional(),
  ...indexShape,
})

const ReasoningPartSchema = z.object({
  type: z.literal('reasoning'),
  text: z.string(),
  state: PartStateSchema,
  ...indexShape,
})

/**
 * One tool-part type per ToolKind. We build each variant with a generic
 * factory so the inferred `Part` type has a literal `type: 'tool-<kind>'`
 * discriminator per variant — `TOOL_KINDS.map(...)` erases those literals
 * (and makes downstream `Extract<Part, ...>` collapse to `never`).
 * Enumerating the ten kinds here keeps both the runtime and the type in
 * sync; adding a new `ToolKind` is still a two-line change (push to
 * TOOL_KINDS, add a line here).
 */
const makeToolPartSchema = <K extends ToolKind>(kind: K) =>
  z.object({
    type: z.literal(`tool-${kind}` as const),
    toolCallId: ToolCallIdSchema,
    status: z.enum(['pending', 'in_progress', 'completed', 'failed', 'cancelled']),
    title: z.string().optional(),
    detail: ToolCallDetailSchema.optional(),
    locations: z.array(FileLocationSchema).optional(),
    result: z
      .object({
        summary: z.string().optional(),
        attachmentId: z.string().optional(),
        data: z.unknown().optional(),
        error: z.string().optional(),
      })
      .optional(),
    ...indexShape,
  })

const TextToolPartSchema = makeToolPartSchema('read')
const EditToolPartSchema = makeToolPartSchema('edit')
const DeleteToolPartSchema = makeToolPartSchema('delete')
const MoveToolPartSchema = makeToolPartSchema('move')
const SearchToolPartSchema = makeToolPartSchema('search')
const ExecuteToolPartSchema = makeToolPartSchema('execute')
const ThinkToolPartSchema = makeToolPartSchema('think')
const FetchToolPartSchema = makeToolPartSchema('fetch')
const TerminalToolPartSchema = makeToolPartSchema('terminal')
const OtherToolPartSchema = makeToolPartSchema('other')

const PlanPartSchema = z.object({
  type: z.literal('plan'),
  plan: z.array(PlanItemSchema),
  ...indexShape,
})

const PermissionPartSchema = z.object({
  type: z.literal('permission'),
  requestId: RequestIdSchema,
  request: PermissionRequestSchema,
  resolution: DecisionSchema.optional(),
  ...indexShape,
})

const QuestionPartSchema = z.object({
  type: z.literal('question'),
  questionId: QuestionIdSchema,
  question: z.string(),
  options: z.array(QuestionOptionSchema).optional(),
  allowFreeform: z.boolean().default(false),
  answer: QuestionAnswerSchema.optional(),
  ...indexShape,
})

/**
 * Custom `data-*` parts. `type` is pinned to the literal 'data' for
 * discriminator performance; the sub-name lives in `name`. Renderers
 * register against `name`.
 */
const DataPartSchema = z.object({
  type: z.literal('data'),
  name: z.string().min(1).max(128),
  id: z.string().min(1),
  value: z.unknown(),
  ...indexShape,
})

export const PartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ReasoningPartSchema,
  TextToolPartSchema,
  EditToolPartSchema,
  DeleteToolPartSchema,
  MoveToolPartSchema,
  SearchToolPartSchema,
  ExecuteToolPartSchema,
  ThinkToolPartSchema,
  FetchToolPartSchema,
  TerminalToolPartSchema,
  OtherToolPartSchema,
  PlanPartSchema,
  PermissionPartSchema,
  QuestionPartSchema,
  DataPartSchema,
])
export type Part = z.infer<typeof PartSchema>

// Dedicated Part subtype aliases. The discriminated union can be noisy to
// narrow in downstream code; these aliases are the blessed shortcut.
export type TextPart = z.infer<typeof TextPartSchema>
export type ReasoningPart = z.infer<typeof ReasoningPartSchema>
export type PlanPart = z.infer<typeof PlanPartSchema>
export type PermissionPart = z.infer<typeof PermissionPartSchema>
export type QuestionPart = z.infer<typeof QuestionPartSchema>
export type DataPart = z.infer<typeof DataPartSchema>

/**
 * Union of all tool-kind part variants. Defined structurally — z.infer over
 * the generic factory collapses K back to `ToolKind`, so the inferred
 * template literal loses information. Mirrors `makeToolPartSchema` exactly;
 * drift is caught by the round-trip schema tests.
 */
export type ToolPart = {
  readonly type: `tool-${ToolKind}`
  readonly toolCallId: z.output<typeof ToolCallIdSchema>
  readonly status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  readonly title?: string
  readonly detail?: z.output<typeof ToolCallDetailSchema>
  readonly locations?: ReadonlyArray<z.output<typeof FileLocationSchema>>
  readonly result?: {
    readonly summary?: string
    readonly attachmentId?: string
    readonly data?: unknown
    readonly error?: string
  }
  readonly index: number
}

export const UIMessageSchema = z.object({
  id: MessageIdSchema,
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(PartSchema),
  createdAt: z.number().int().min(0),
  completedAt: z.number().int().min(0).optional(),
  stopReason: StopReasonSchema.optional(),
})
export type UIMessage = z.infer<typeof UIMessageSchema>
