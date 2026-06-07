// -----------------------------------------------------------------------------
// Input / output schemas for every `agent.session.*` and `agent.providers.*`
// oRPC procedure.
//
// The router (03-orpc-router) consumes these directly. Branded id types are
// type-level only; at runtime these schemas validate strings.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { AgentCapabilitiesSchema, AgentModeSchema, ModelOptionSchema, ReasoningEffortSchema } from './capabilities.ts'
import { ImageRefSchema, PromptBlockSchema } from './content.ts'
import {
  ModeIdSchema,
  ModelIdSchema,
  ProviderIdSchema,
  QuestionIdSchema,
  RequestIdSchema,
  SessionIdSchema,
  TurnIdSchema,
} from './ids.ts'
import { DecisionSchema, QuestionAnswerSchema } from './permission.ts'

// --- agent.session.create -----------------------------------------------------

export const CreateSessionInputSchema = z.object({
  providerId: ProviderIdSchema,
  cwd: z.string().min(1).max(4096),
  resumeHandle: z.unknown().optional(),
  modeId: ModeIdSchema.optional(),
  modelId: ModelIdSchema.optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  mcpServers: z.array(z.unknown()).optional(),
  /** Workspace binding; null for ad-hoc sessions. */
  workspaceId: z.string().min(1).nullable().default(null),
})
export const CreateSessionOutputSchema = z.object({
  sessionId: SessionIdSchema,
  capabilities: AgentCapabilitiesSchema,
  modes: z.array(AgentModeSchema),
  modelOptions: z.array(ModelOptionSchema),
})
export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>
export type CreateSessionOutput = z.infer<typeof CreateSessionOutputSchema>

// --- agent.session.prompt -----------------------------------------------------

export const PromptInputSchema = z.object({
  sessionId: SessionIdSchema,
  content: z.array(PromptBlockSchema).min(1),
  options: z
    .object({
      modeId: ModeIdSchema.optional(),
      images: z.array(ImageRefSchema).optional(),
    })
    .optional(),
})
export const PromptOutputSchema = z.object({
  turnId: TurnIdSchema,
})
export type PromptInput = z.infer<typeof PromptInputSchema>
export type PromptOutput = z.infer<typeof PromptOutputSchema>

// --- agent.session.cancel -----------------------------------------------------

export const CancelSessionInputSchema = z.object({ sessionId: SessionIdSchema })
export const CancelSessionOutputSchema = z.object({ cancelled: z.boolean() })
export type CancelSessionInput = z.infer<typeof CancelSessionInputSchema>
export type CancelSessionOutput = z.infer<typeof CancelSessionOutputSchema>

// --- agent.session.setMode ----------------------------------------------------

export const SetModeInputSchema = z.object({
  sessionId: SessionIdSchema,
  modeId: ModeIdSchema,
})
export const SetModeOutputSchema = z.object({ modeId: ModeIdSchema })
export type SetModeInput = z.infer<typeof SetModeInputSchema>
export type SetModeOutput = z.infer<typeof SetModeOutputSchema>

// --- agent.session.setModel ---------------------------------------------------

export const SetModelInputSchema = z.object({
  sessionId: SessionIdSchema,
  modelId: ModelIdSchema,
})
export const SetModelOutputSchema = z.object({ modelId: ModelIdSchema })
export type SetModelInput = z.infer<typeof SetModelInputSchema>
export type SetModelOutput = z.infer<typeof SetModelOutputSchema>

// --- agent.session.setReasoningEffort ----------------------------------------

export const SetReasoningEffortInputSchema = z.object({
  sessionId: SessionIdSchema,
  reasoningEffort: ReasoningEffortSchema,
})
export const SetReasoningEffortOutputSchema = z.object({ reasoningEffort: ReasoningEffortSchema })
export type SetReasoningEffortInput = z.infer<typeof SetReasoningEffortInputSchema>
export type SetReasoningEffortOutput = z.infer<typeof SetReasoningEffortOutputSchema>

// --- agent.session.startReview ------------------------------------------------
//
// Runs as a turn on the existing thread. The server emits the same
// item/turn notifications as a regular prompt, and the turn completion
// fires the ordinary `turn.completed` event — the UI doesn't need a
// separate "review" result channel. Only the triggering differs.

export const ReviewTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('uncommittedChanges') }),
  z.object({ type: z.literal('baseBranch'), branch: z.string().min(1) }),
  z.object({
    type: z.literal('commit'),
    sha: z.string().min(1),
    title: z.string().max(512).optional(),
  }),
  z.object({ type: z.literal('custom'), instructions: z.string().min(1).max(8192) }),
])
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>

export const StartReviewInputSchema = z.object({
  sessionId: SessionIdSchema,
  target: ReviewTargetSchema,
})
export const StartReviewOutputSchema = z.object({
  turnId: TurnIdSchema.optional(),
  reviewThreadId: z.string().optional(),
})
export type StartReviewInput = z.infer<typeof StartReviewInputSchema>
export type StartReviewOutput = z.infer<typeof StartReviewOutputSchema>

// --- agent.session.respondPermission ------------------------------------------

export const RespondPermissionInputSchema = z.object({
  sessionId: SessionIdSchema,
  requestId: RequestIdSchema,
  decision: DecisionSchema,
})
export const RespondPermissionOutputSchema = z.object({ accepted: z.boolean() })
export type RespondPermissionInput = z.infer<typeof RespondPermissionInputSchema>
export type RespondPermissionOutput = z.infer<typeof RespondPermissionOutputSchema>

// --- agent.session.respondQuestion --------------------------------------------

export const RespondQuestionInputSchema = z.object({
  sessionId: SessionIdSchema,
  questionId: QuestionIdSchema,
  answer: QuestionAnswerSchema,
})
export const RespondQuestionOutputSchema = z.object({ accepted: z.boolean() })
export type RespondQuestionInput = z.infer<typeof RespondQuestionInputSchema>
export type RespondQuestionOutput = z.infer<typeof RespondQuestionOutputSchema>

// --- agent.session.close ------------------------------------------------------

export const CloseSessionInputSchema = z.object({ sessionId: SessionIdSchema })
export const CloseSessionOutputSchema = z.object({ closed: z.boolean() })
export type CloseSessionInput = z.infer<typeof CloseSessionInputSchema>
export type CloseSessionOutput = z.infer<typeof CloseSessionOutputSchema>

// --- agent.permissions.* ------------------------------------------------------

export const PermissionPolicyBehaviourSchema = z.enum(['allow', 'deny'])
export type PermissionPolicyBehaviour = z.infer<typeof PermissionPolicyBehaviourSchema>

export const PermissionPolicySchema = z.object({
  policyId: z.string().min(1),
  workspaceId: z.string().min(1),
  providerId: z.string().min(1),
  toolKind: z.string().min(1),
  toolName: z.string().min(1),
  locationPattern: z.string(),
  behaviour: PermissionPolicyBehaviourSchema,
  denyMessage: z.string().optional(),
  expiresAt: z.number().nullable(),
  createdAt: z.number(),
})
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>

export const ListPoliciesInputSchema = z.object({
  workspaceId: z.string().min(1),
})
export const ListPoliciesOutputSchema = z.array(PermissionPolicySchema)
export type ListPoliciesInput = z.infer<typeof ListPoliciesInputSchema>
export type ListPoliciesOutput = z.infer<typeof ListPoliciesOutputSchema>

export const RevokePolicyInputSchema = z.object({
  policyId: z.string().min(1),
})
export const RevokePolicyOutputSchema = z.object({ revoked: z.boolean() })
export type RevokePolicyInput = z.infer<typeof RevokePolicyInputSchema>
export type RevokePolicyOutput = z.infer<typeof RevokePolicyOutputSchema>

// --- agent.providers.list -----------------------------------------------------

export const ProviderManifestSchema = z.object({
  id: ProviderIdSchema,
  label: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  available: z.boolean(),
  hasSettings: z.boolean().default(false),
  /** Capabilities the provider advertises *before* a session is spawned. */
  advertisedCapabilities: AgentCapabilitiesSchema.partial().default({}),
  requires: z.enum(['electron', 'browser', 'any']).default('any'),
})
export const ListProvidersOutputSchema = z.array(ProviderManifestSchema)
export type ProviderManifest = z.infer<typeof ProviderManifestSchema>

// --- agent.providers.installed ------------------------------------------------

export const InstalledProviderSchema = z.object({
  id: ProviderIdSchema,
  available: z.boolean(),
  version: z.string().min(1).max(64).optional(),
  authNeeded: z.boolean().default(false),
  lastError: z.string().max(1024).optional(),
})
export const ListInstalledProvidersOutputSchema = z.array(InstalledProviderSchema)
export type InstalledProvider = z.infer<typeof InstalledProviderSchema>
