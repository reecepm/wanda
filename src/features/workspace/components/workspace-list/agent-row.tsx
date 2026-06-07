import { cn } from '@/shared/utils'
import { AGENT_ATTENTION_DOT, AGENT_STATUS_DOT } from '../../utils/status-colors'
import { AgentTypeIcon } from './agent-type-icon'
import type { AgentSummary } from './types'

export function AgentRow({
  agent,
  isSelected,
  onSelect,
  showApproval,
}: {
  agent: AgentSummary
  isSelected: boolean
  onSelect: () => void
  showApproval?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex items-start gap-2 w-full pl-2 pr-2 py-[5px] rounded-md text-left transition-colors duration-150',
        isSelected ? 'bg-white/[0.06] text-zinc-200' : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300',
      )}
    >
      <div className="shrink-0 mt-[2px]">
        <AgentTypeIcon type={agent.agentType} />
      </div>
      <div className="flex flex-col min-w-0 flex-1 gap-px">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] truncate leading-tight">{agent.name}</span>
          <span
            className={cn(
              'h-[5px] w-[5px] rounded-full shrink-0',
              agent.needsAttention ? AGENT_ATTENTION_DOT : AGENT_STATUS_DOT[agent.status],
            )}
          />
        </div>
        {showApproval && agent.needsAttention && agent.attentionReason && (
          <span className="text-[10px] text-amber-400/70 truncate leading-tight">{agent.attentionReason}</span>
        )}
      </div>
    </button>
  )
}
