// -----------------------------------------------------------------------------
// Codex capability baseline. Unlike ACP, Codex does not advertise modes
// over the wire; we define them ourselves per spec 07 §3.2.
// `modelOptions` get filled in from the `model/list` response at session
// start — the baseline below has an empty array.
// -----------------------------------------------------------------------------

import type {
  AgentMode,
  ModeId,
  ModelId,
  ModelOption,
  AgentCapabilities as WandaCapabilities,
} from '@wanda/agent-protocol'
import type { ApprovalPolicy, ApprovalsReviewer, SandboxPolicy } from './protocol.ts'

export const CODEX_BASE_CAPABILITIES: WandaCapabilities = {
  protocolVersion: '1.0-codex',
  supportsPlanMode: true,
  supportsAutoMode: true,
  supportsReasoning: true,
  supportsToolInvocations: true,
  supportsDiffs: true,
  supportsTerminalBlocks: true,
  supportsImages: true,
  supportsSessionResume: true,
  supportsMcpServers: true,
  // Codex 0.104 ships `review/start`; renderer surfaces a "Review
  // changes" button on the composer when this is true.
  supportsReview: true,
  supportsElicitation: true,
  modes: [],
  modelOptions: [],
  extensions: {},
}

export const CODEX_MODE_AUTO = 'auto' as ModeId
export const CODEX_MODE_AUTO_REVIEW = 'auto-review' as ModeId
export const CODEX_MODE_FULL_ACCESS = 'full-access' as ModeId

export const CODEX_MODES: ReadonlyArray<AgentMode> = [
  {
    id: CODEX_MODE_AUTO,
    label: 'Default Permissions',
    description: 'Auto-edit in workspace, prompt for shell commands',
    colorTier: 'moderate',
    allowsToolExecution: true,
  },
  {
    id: CODEX_MODE_AUTO_REVIEW,
    label: 'Auto Review',
    description: 'Codex auto-runs trusted commands and routes risky approvals to its review subagent',
    colorTier: 'moderate',
    allowsToolExecution: true,
  },
  {
    id: CODEX_MODE_FULL_ACCESS,
    label: 'Full Access',
    description: 'No approval prompts; full filesystem + network',
    colorTier: 'dangerous',
    allowsToolExecution: true,
  },
]

export const CODEX_DEFAULT_MODE_ID: ModeId = CODEX_MODE_AUTO

export const CODEX_FALLBACK_MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  {
    id: 'gpt-5.5' as ModelId,
    label: 'GPT-5.5',
    description: 'Latest high-capability Codex model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: true,
  },
  {
    id: 'gpt-5.4' as ModelId,
    label: 'GPT-5.4',
    description: 'High-capability Codex model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.4-mini' as ModelId,
    label: 'GPT-5.4 Mini',
    description: 'Faster GPT-5.4 Codex model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.3-codex' as ModelId,
    label: 'GPT-5.3 Codex',
    description: 'Codex-optimized GPT-5.3 model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.3-codex-spark' as ModelId,
    label: 'GPT-5.3 Codex Spark',
    description: 'Fast Codex-optimized GPT-5.3 model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium'],
    defaultReasoningEffort: 'low',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5.2' as ModelId,
    label: 'GPT-5.2',
    description: 'Previous-generation GPT-5 model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5' as ModelId,
    label: 'GPT-5',
    description: 'General-purpose Codex model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    supportsImages: true,
    isDefault: false,
  },
  {
    id: 'gpt-5-mini' as ModelId,
    label: 'GPT-5 Mini',
    description: 'Faster, lower-cost Codex model',
    supportsReasoning: true,
    supportedReasoningEfforts: ['minimal', 'low', 'medium'],
    defaultReasoningEffort: 'low',
    supportsImages: true,
    isDefault: false,
  },
]

/**
 * Derive Codex's `approvalPolicy` + `sandbox` for a given Wanda mode id.
 * Applied on each `turn/start` — Codex does not have persistent
 * server-side mode state (spec 07 §3.2).
 *
 * Note the two shapes: `thread/start` accepts a kebab-case string under
 * `sandbox`, while `turn/start` takes a tagged object under `sandboxPolicy`
 * with a camelCase `type` field. `codexTurnSandboxPolicy` builds the turn
 * variant; this function returns the thread variant.
 */
export function codexPolicyForMode(modeId: ModeId | null | undefined): {
  approvalPolicy: ApprovalPolicy
  approvalsReviewer?: ApprovalsReviewer
  sandbox: SandboxPolicy
} {
  if (modeId === CODEX_MODE_FULL_ACCESS) {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' }
  }
  if (modeId === CODEX_MODE_AUTO_REVIEW) {
    return {
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    }
  }
  // auto or unknown → safe default
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write' }
}

/**
 * Tagged-enum sandbox payload for `turn/start.sandboxPolicy`. Codex's Rust
 * serde enum serialises to `{ "type": "workspaceWrite" | "readOnly" |
 * "dangerFullAccess", ... }` — the bare kebab-case string used by
 * `thread/start.sandbox` is rejected here.
 */
export function codexTurnSandboxPolicy(modeId: ModeId | null | undefined): {
  readonly type: 'workspaceWrite' | 'readOnly' | 'dangerFullAccess'
} {
  if (modeId === CODEX_MODE_FULL_ACCESS) {
    return { type: 'dangerFullAccess' }
  }
  return { type: 'workspaceWrite' }
}

/**
 * Normalise a Codex model display name so a user-visible string isn't just
 * `gpt-5-nano` when the vendor brand is `GPT-5 Nano`. Pure, safe on any input.
 */
export function normalizeCodexModelLabel(raw: string | undefined): string | undefined {
  if (!raw) return raw
  return raw
    .replace(/^gpt-/i, 'GPT-')
    .replace(/^o(\d)/, 'o$1')
    .replace(/-mini\b/gi, ' Mini')
    .replace(/-codex\b/gi, ' Codex')
    .replace(/-spark\b/gi, ' Spark')
    .replace(/\bmini\b/gi, 'Mini')
    .replace(/\bcodex\b/gi, 'Codex')
    .replace(/\bspark\b/gi, 'Spark')
    .replace(/\bnano\b/gi, 'Nano')
}
