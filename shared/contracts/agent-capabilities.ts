// -----------------------------------------------------------------------------
// Cross-boundary re-exports for AgentCapabilities, modes, models.
//
// Distinct from `capabilities.ts` (server-level env flags).
// -----------------------------------------------------------------------------

export type {
  AgentCapabilities,
  AgentMode,
  ModeColorTier,
  ModelOption,
} from '@wanda/agent-protocol'
export {
  AgentCapabilitiesSchema,
  AgentModeSchema,
  ModeColorTierSchema,
  ModelOptionSchema,
} from '@wanda/agent-protocol'
