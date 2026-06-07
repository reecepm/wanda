import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { AGENT_STATUS_DOT, type AgentStatus } from '@/features/workspace'
import { cn } from '@/shared/utils'
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup } from '@/ui/avatar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip'
import type { TrayPodAgent } from '../hooks/use-tray-data'

const AGENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

const MAX_VISIBLE = 3

interface TrayAgentStackProps {
  agents: TrayPodAgent[]
  onAgentClick: (agent: TrayPodAgent) => void
}

export function TrayAgentStack({ agents, onAgentClick }: TrayAgentStackProps) {
  if (agents.length === 0) return null

  const visible = agents.slice(0, MAX_VISIBLE)
  const overflow = agents.slice(MAX_VISIBLE)

  return (
    <AvatarGroup className="-space-x-1.5">
      {visible.map((agent) => (
        <AgentAvatar key={agent.id} agent={agent} onClick={() => onAgentClick(agent)} />
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger onClick={(e) => e.stopPropagation()} className="cursor-default" render={<div />}>
            <div className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] text-muted-foreground ring-2 ring-background">
              +{overflow.length}
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-48">
            <div className="flex flex-col gap-1 py-0.5">
              {overflow.map((agent) => {
                const agentStatus = (agent.status?.status ?? 'stopped') as AgentStatus
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAgentClick(agent)
                    }}
                    className="flex items-center gap-1.5 text-left hover:opacity-80"
                  >
                    <span className={cn('size-[5px] rounded-full shrink-0', AGENT_STATUS_DOT[agentStatus])} />
                    <span className="truncate text-[11px]">{agent.name}</span>
                  </button>
                )
              })}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </AvatarGroup>
  )
}

function AgentAvatar({ agent, onClick }: { agent: TrayPodAgent; onClick: () => void }) {
  const Icon = AGENT_ICON[agent.agentType] ?? ClaudeIcon
  const agentStatus = (agent.status?.status ?? 'stopped') as AgentStatus

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className="cursor-pointer"
        render={<button type="button" />}
      >
        <Avatar size="sm">
          <AvatarFallback className="bg-zinc-800">
            <Icon className="size-3" />
          </AvatarFallback>
          <AvatarBadge className={cn('!size-1.5 !ring-1', AGENT_STATUS_DOT[agentStatus])} />
        </Avatar>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {agent.name} ({agentStatus.replace('_', ' ')})
      </TooltipContent>
    </Tooltip>
  )
}
