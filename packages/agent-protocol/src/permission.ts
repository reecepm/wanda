// -----------------------------------------------------------------------------
// Permissions, decisions, and policy rows.
//
// Reconciliations (see 00-index):
//   R7 — `Decision` is permission-only. Questions use their own event kind
//        (`question.requested`) and procedure (`respondQuestion`). No
//        `answer` field on `Decision`.
//   R8 — Question options are `{ id, label, description? }` so selection is
//        stable across re-renders; answer is a tagged `option | freeform`.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { ModeIdSchema, PlanItemIdSchema, QuestionIdSchema, ToolCallIdSchema } from './ids.ts'
import { PlanItemSchema } from './plan.ts'
import { ToolCallDetailSchema } from './tool-detail.ts'

export const PermissionActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  behaviour: z.enum(['allow', 'deny']),
  scope: z.enum(['once', 'session', 'always']).default('once'),
  disabledReason: z.string().max(512).optional(),
})
export type PermissionAction = z.infer<typeof PermissionActionSchema>

/** Option advertised on a question. `id` is stable across re-renders. */
export const QuestionOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(512),
  description: z.string().max(1024).optional(),
})
export type QuestionOption = z.infer<typeof QuestionOptionSchema>

/** User's answer to a question. Option selection by id, or freeform text. */
export const QuestionAnswerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('option'),
    optionId: z.string().min(1).max(64),
  }),
  z.object({
    kind: z.literal('freeform'),
    text: z.string().min(1).max(16_384),
  }),
])
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>

export const PermissionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    toolCallId: ToolCallIdSchema,
    title: z.string().min(1).max(512),
    detail: ToolCallDetailSchema,
    actions: z.array(PermissionActionSchema).optional(),
  }),
  z.object({
    kind: z.literal('plan'),
    planId: PlanItemIdSchema,
    plan: z.array(PlanItemSchema).min(1),
  }),
  z.object({
    kind: z.literal('question'),
    questionId: QuestionIdSchema,
    question: z.string().min(1).max(4096),
    options: z.array(QuestionOptionSchema).optional(),
    /** When true, a free-text input renders alongside options. */
    allowFreeform: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('mode'),
    proposedModeId: ModeIdSchema,
    reason: z.string().max(1024).optional(),
  }),
  z.object({
    kind: z.literal('other'),
    title: z.string().min(1).max(512),
    description: z.string().max(4096).optional(),
  }),
])
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>

export const PermissionScopeSchema = z.enum(['once', 'session', 'always'])
export type PermissionScope = z.infer<typeof PermissionScopeSchema>

export const DecisionSchema = z.discriminatedUnion('behaviour', [
  z.object({
    behaviour: z.literal('allow'),
    scope: PermissionScopeSchema,
  }),
  z.object({
    behaviour: z.literal('deny'),
    scope: PermissionScopeSchema,
    message: z.string().max(4096).optional(),
  }),
])
export type Decision = z.infer<typeof DecisionSchema>

/**
 * Persisted row used by the `permission_policies` table. The runtime
 * consults this before emitting `permission.requested` — a `scope: 'always'`
 * allow short-circuits the event.
 */
export const PermissionPolicyRowSchema = z.object({
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  toolKind: z.string().min(1),
  locationPattern: z.string().nullable(),
  behaviour: z.enum(['allow', 'deny']),
  createdAt: z.number().int().min(0),
  expiresAt: z.number().int().min(0).nullable(),
  note: z.string().max(2048).optional(),
})
export type PermissionPolicyRow = z.infer<typeof PermissionPolicyRowSchema>
