// -----------------------------------------------------------------------------
// AgentCapabilities, AgentMode, ModelOption.
//
// Declared by each provider at `initialize`. Renderer reads only this — no
// providerId branching in UI code.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { ModeIdSchema, ModelIdSchema } from './ids.ts'

export const ReasoningEffortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>

export const ModeColorTierSchema = z.enum(['safe', 'moderate', 'planning', 'dangerous'])
export type ModeColorTier = z.infer<typeof ModeColorTierSchema>

export const AgentModeSchema = z.object({
  id: ModeIdSchema,
  label: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  colorTier: ModeColorTierSchema.default('moderate'),
  /** Provider-declared; the runtime does not enforce. */
  allowsToolExecution: z.boolean().default(true),
})
export type AgentMode = z.infer<typeof AgentModeSchema>

export const ModelOptionSchema = z.object({
  id: ModelIdSchema,
  label: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  contextWindow: z.number().int().positive().optional(),
  supportsReasoning: z.boolean().default(false),
  supportedReasoningEfforts: z.array(ReasoningEffortSchema).optional(),
  defaultReasoningEffort: ReasoningEffortSchema.optional(),
  supportsImages: z.boolean().default(false),
  isDefault: z.boolean().default(false),
})
export type ModelOption = z.infer<typeof ModelOptionSchema>

export const AgentCapabilitiesSchema = z.object({
  protocolVersion: z.string().min(1).max(32),
  supportsPlanMode: z.boolean().default(false),
  supportsAutoMode: z.boolean().default(false),
  supportsReasoning: z.boolean().default(false),
  supportsToolInvocations: z.boolean().default(true),
  supportsDiffs: z.boolean().default(false),
  supportsTerminalBlocks: z.boolean().default(false),
  supportsImages: z.boolean().default(false),
  supportsSessionResume: z.boolean().default(false),
  supportsMcpServers: z.boolean().default(false),
  /**
   * True when the agent exposes a first-class code-review action that
   * runs as a turn (Codex `review/start`). Renderer shows a
   * "Review changes" button on the composer when set. Distinct from
   * `supportsPlanMode` — review is a one-shot, plan is a continuous
   * mode.
   */
  supportsReview: z.boolean().default(false),
  /** True when the agent emits `permission.requested` events. */
  supportsElicitation: z.boolean().default(true),
  modes: z.array(AgentModeSchema).default([]),
  modelOptions: z.array(ModelOptionSchema).default([]),
  extensions: z.record(z.string(), z.unknown()).default({}),
})
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>
