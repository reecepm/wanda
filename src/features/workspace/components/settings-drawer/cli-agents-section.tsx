import { AgentCliConfigSection } from '@/features/settings'
import { SectionHeading } from './fields'

export function CliAgentsSection({ workspaceId }: { workspaceId: string }) {
  return (
    <section>
      <SectionHeading>CLI Agents</SectionHeading>
      <div className="flex flex-col gap-6">
        <AgentCliConfigSection scope="workspace" scopeId={workspaceId} agentType="claude" />
        <AgentCliConfigSection scope="workspace" scopeId={workspaceId} agentType="codex" />
        <AgentCliConfigSection scope="workspace" scopeId={workspaceId} agentType="opencode" />
      </div>
    </section>
  )
}
