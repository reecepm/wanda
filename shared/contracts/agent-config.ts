import type { AgentType } from './domain-types'

export type AgentCliFlagId = 'dangerouslySkipPermissions' | 'goals'

export type AgentConfigPayload = {
  readonly flags?: Record<AgentCliFlagId | string, boolean>
  readonly extraArgs?: string[]
}

export type AgentCliFlagDefinition = {
  readonly id: AgentCliFlagId
  readonly label: string
  readonly description: string
  readonly args: readonly string[]
  readonly dangerous?: boolean
}

export const AGENT_CLI_FLAG_DEFINITIONS: Record<AgentType, readonly AgentCliFlagDefinition[]> = {
  claude: [
    {
      id: 'dangerouslySkipPermissions',
      label: 'Skip permission prompts',
      description: 'Launches Claude with --dangerously-skip-permissions.',
      args: ['--dangerously-skip-permissions'],
      dangerous: true,
    },
  ],
  codex: [
    {
      id: 'goals',
      label: 'Goals',
      description: 'Launches Codex with --enable goals.',
      args: ['--enable', 'goals'],
    },
  ],
  opencode: [],
}

export function resolveAgentCliArgs(agentType: AgentType, config: AgentConfigPayload | null | undefined): string[] {
  if (!config) return []

  const args: string[] = []
  for (const flag of AGENT_CLI_FLAG_DEFINITIONS[agentType]) {
    if (config.flags?.[flag.id]) args.push(...flag.args)
  }
  if (Array.isArray(config.extraArgs)) {
    args.push(...config.extraArgs.filter((arg) => arg.length > 0))
  }
  return args
}
