import type { AgentType } from '@/types/schema'

export type AgentOptionKind = 'session' | 'cli'
export type AgentProviderVisual = 'codex' | 'claude' | 'opencode' | 'mock'

export interface AgentOption {
  readonly id: string
  readonly label: string
  readonly kind: AgentOptionKind
  readonly provider: AgentProviderVisual
  readonly sessionProviderId?: string
  readonly cliAgentType?: AgentType
  readonly description?: string
  readonly disabled?: boolean
  readonly statusDetail?: string
}

interface SessionProviderManifest {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly available?: boolean
}

interface InstalledProviderStatus {
  readonly id: string
  readonly available: boolean
  readonly authNeeded?: boolean
  readonly version?: string
  readonly failureReason?: string
  readonly lastError?: string
}

export function buildSessionAgentOptions({
  providers,
  installed,
}: {
  providers?: ReadonlyArray<SessionProviderManifest>
  installed?: ReadonlyArray<InstalledProviderStatus>
}): ReadonlyArray<AgentOption> {
  if (!providers) return []

  const installedById = new Map(installed?.map((status) => [status.id, status]))

  return providers.map((provider) => {
    const install = installedById.get(provider.id)
    const providerUnavailable = provider.available === false
    const installUnavailable = install?.available === false
    const authNeeded = install?.authNeeded === true
    const disabled = providerUnavailable || installUnavailable || authNeeded

    return {
      id: `session:${provider.id}`,
      label: provider.label,
      kind: 'session',
      provider: providerVisualForId(provider.id),
      sessionProviderId: provider.id,
      description: provider.description,
      disabled,
      statusDetail: authNeeded
        ? 'Sign in required'
        : installUnavailable
          ? (install.failureReason ?? install.lastError ?? 'Not installed')
          : providerUnavailable
            ? 'Unavailable'
            : (install?.version ?? undefined),
    }
  })
}

export const CLI_AGENT_OPTIONS: ReadonlyArray<AgentOption> = [
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    kind: 'cli',
    provider: 'codex',
    cliAgentType: 'codex' as AgentType,
    description: 'Codex terminal CLI',
  },
  {
    id: 'claude-cli',
    label: 'Claude CLI (terminal)',
    kind: 'cli',
    provider: 'claude',
    cliAgentType: 'claude' as AgentType,
    description: 'Runs the local claude CLI in a terminal. Uses your local Claude login.',
  },
  {
    id: 'opencode-cli',
    label: 'OpenCode CLI',
    kind: 'cli',
    provider: 'opencode',
    cliAgentType: 'opencode' as AgentType,
    description: 'OpenCode terminal CLI',
  },
]

export function providerVisualForId(providerId: string): AgentProviderVisual {
  const id = providerId.toLowerCase()
  if (id.includes('claude')) return 'claude'
  if (id.includes('codex') || id.includes('openai')) return 'codex'
  if (id.includes('opencode')) return 'opencode'
  if (id.includes('mock')) return 'mock'
  return 'mock'
}
