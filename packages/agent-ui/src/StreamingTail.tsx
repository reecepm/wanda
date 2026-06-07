// -----------------------------------------------------------------------------
// StreamingTail — render the live text/reasoning tail for an active turn.
// Attached as a sibling of the active assistant message so the committed
// store doesn't need to re-allocate `state.messages` on every delta.
// -----------------------------------------------------------------------------

import type { MessageId, SessionId } from '@wanda/agent-protocol'
import { cn } from './cn'
import { useStreamingPart } from './hooks/useAgentMessages'
import { IconBrain } from './ui/icons'
import { Markdown } from './ui/Markdown'
import { Shimmer, ShimmerDot } from './ui/Shimmer'

export function StreamingTail({
  sessionId,
  messageId,
  kind = 'text',
  className,
}: {
  sessionId: SessionId
  messageId: MessageId
  kind?: 'text' | 'reasoning'
  className?: string
}) {
  const snapshot = useStreamingPart(sessionId, messageId, kind)
  if (!snapshot) return null
  if (kind === 'reasoning') {
    return (
      <div className={cn('text-muted-foreground', className)} data-streaming="reasoning">
        <div className="flex h-7 items-center gap-2 text-[11px] uppercase tracking-[0.12em]">
          <IconBrain className="text-foreground/60" />
          <Shimmer>Thinking</Shimmer>
        </div>
        <div className="mt-1 whitespace-pre-wrap border-l border-border/70 pl-3 font-sans text-[12px] italic leading-[1.65] text-muted-foreground/90">
          {snapshot.text}
        </div>
      </div>
    )
  }
  return (
    <div className={cn('relative', className)} data-streaming="text">
      <Markdown text={snapshot.text} className="opacity-95" />
      <span className="ml-1 inline-block align-middle">
        <ShimmerDot />
      </span>
    </div>
  )
}
