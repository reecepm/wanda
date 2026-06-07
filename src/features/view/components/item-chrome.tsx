import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { providerVisualForId } from '@/features/pod'
import { usePodColor } from '@/features/view/hooks/use-pod-color'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import { RiFileTextLine, RiGlobalLine, RiTerminalBoxLine, RiTerminalLine } from '@/lib/icons'
import type { AgentItemConfig, AgentSessionItemConfig, PodItemConfig } from '@/types/schema'

const AGENT_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  claude: { label: 'Claude', bg: 'bg-orange-500/15', text: 'text-orange-400' },
  codex: { label: 'Codex', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  opencode: { label: 'OC', bg: 'bg-blue-500/15', text: 'text-blue-400' },
  mock: { label: 'Mock', bg: 'bg-zinc-500/15', text: 'text-zinc-400' },
}

const AGENT_ICON: Record<string, (props: { className?: string }) => React.ReactNode> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

/** Icon for a pod item based on its content type. */
export function ItemIcon({
  contentType,
  className,
  config,
}: {
  contentType: string
  className?: string
  config?: PodItemConfig
}) {
  const cls = className ?? 'h-3.5 w-3.5 text-zinc-300 shrink-0'
  switch (contentType) {
    case 'browser':
      return <RiGlobalLine className={cls} />
    case 'agent': {
      const agentType = config ? (config as AgentItemConfig).agentType : undefined
      const Icon = agentType ? AGENT_ICON[agentType] : undefined
      if (Icon) return <Icon className={cls} />
      return <ClaudeIcon className={cls} />
    }
    case 'agent-session': {
      const providerId = config ? (config as AgentSessionItemConfig).providerId : undefined
      const Icon = providerId ? AGENT_ICON[providerVisualForId(providerId)] : undefined
      if (Icon) return <Icon className={cls} />
      return <ClaudeIcon className={cls} />
    }
    case 'command':
      return <RiTerminalBoxLine className={cls} />
    case 'markdown':
      return <RiFileTextLine className={cls} />
    default:
      return <RiTerminalLine className={cls} />
  }
}

/** Small colored pill showing the pod name. Only renders at workspace+ scopes. */
export function PodPill({ podId }: { podId?: string }) {
  const color = usePodColor(podId)
  const { pods } = useViewScope()
  if (!color || !podId || !pods) return null
  const pod = pods.find((p) => p.id === podId)
  if (!pod) return null
  return (
    <span
      className="shrink-0 text-[9px] font-semibold leading-none rounded px-1.5 py-0.5 mr-1.5 text-white/90 truncate max-w-[80px]"
      style={{ backgroundColor: color.hex }}
      title={pod.name}
    >
      {pod.name}
    </span>
  )
}

/** Small colored badge for agent items, showing the agent type. Renders nothing for non-agents. */
export function AgentBadge({ contentType, config }: { contentType: string; config: PodItemConfig }) {
  const agentType =
    contentType === 'agent'
      ? (config as AgentItemConfig).agentType
      : contentType === 'agent-session'
        ? (config as AgentSessionItemConfig).providerId
          ? providerVisualForId((config as AgentSessionItemConfig).providerId as string)
          : null
        : null
  if (!agentType) return null
  const badge = AGENT_BADGE[agentType]
  if (!badge) return null
  return (
    <span className={`shrink-0 text-[9px] font-semibold leading-none rounded px-1 py-0.5 ${badge.bg} ${badge.text}`}>
      {badge.label}
    </span>
  )
}
