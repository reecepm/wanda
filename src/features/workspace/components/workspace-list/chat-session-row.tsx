import { RiChatHistoryLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { AGENT_ATTENTION_DOT } from '../../utils/status-colors'
import type { ChatSessionSummary } from './types'

export function ChatSessionRow({
  session,
  isSelected,
  onSelect,
}: {
  session: ChatSessionSummary
  isSelected: boolean
  onSelect: () => void
}) {
  const dotClass = session.needsAttention
    ? AGENT_ATTENTION_DOT
    : session.state === 'running'
      ? 'bg-emerald-400'
      : session.state === 'error'
        ? 'bg-red-400'
        : session.state === 'closed'
          ? 'bg-zinc-600'
          : session.resident
            ? 'bg-zinc-400'
            : 'bg-zinc-600'
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
        <RiChatHistoryLine className="size-3 text-zinc-400" />
      </div>
      <div className="flex flex-col min-w-0 flex-1 gap-px">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] truncate leading-tight">{session.name}</span>
          <span className={cn('h-[5px] w-[5px] rounded-full shrink-0', dotClass)} />
        </div>
        {session.needsAttention && session.attentionReason && (
          <span className="text-[10px] text-amber-400/70 truncate leading-tight">{session.attentionReason}</span>
        )}
      </div>
    </button>
  )
}
