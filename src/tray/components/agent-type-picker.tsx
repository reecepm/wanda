import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { AGENT_TYPES } from '@/features/pod/utils/agent-utils'
import { cn } from '@/shared/utils'
import type { AgentType } from '@/types/schema'

const AGENT_TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

interface AgentTypePickerProps {
  value: AgentType
  onChange: (type: AgentType) => void
}

export function AgentTypePicker({ value, onChange }: AgentTypePickerProps) {
  return (
    <div className="flex gap-1">
      {AGENT_TYPES.map((opt) => {
        const Icon = AGENT_TYPE_ICON[opt.id]
        const isSelected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] transition-colors',
              isSelected
                ? 'bg-primary/10 text-primary ring-1 ring-primary/30'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            {Icon && <Icon className="size-3" />}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
