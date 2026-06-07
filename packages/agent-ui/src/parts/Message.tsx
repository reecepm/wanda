// -----------------------------------------------------------------------------
// MessageBubble — renders one UIMessage.
//
// User messages are right-aligned in a subtle pill.
// Assistant messages flow full-width with their reasoning/tools/text
// stacked under a shared left rail (provided by the parent TurnBlock).
// -----------------------------------------------------------------------------

import type { Part, SessionId, UIMessage } from '@wanda/agent-protocol'
import { cn } from '../cn'
import { PermissionPart } from './PermissionPart'
import { PlanPart } from './PlanPart'
import { QuestionPart } from './QuestionPart'
import { ReasoningPart } from './ReasoningPart'
import { TextPart } from './TextPart'
import { asToolPart, ToolCallPart } from './ToolCallPart'

export function MessageBubble({
  sessionId,
  message,
  compact,
}: {
  sessionId: SessionId
  message: UIMessage
  /** Omit role wrapper — used inside a TurnBlock that already owns framing. */
  compact?: boolean
}) {
  const parts = [...message.parts].sort((a, b) => a.index - b.index)

  if (message.role === 'user') {
    return (
      <article data-message-id={message.id as unknown as string} data-message-role="user" className="flex justify-end">
        <div
          className={cn(
            'max-w-[75%] rounded-2xl rounded-br-md border-[0.5px] border-border bg-muted/50',
            'px-3.5 py-2.5 text-[13px] text-foreground',
          )}
        >
          <div className="flex flex-col gap-2">
            {parts.map((part) => (
              <PartView key={partKey(part)} sessionId={sessionId} part={part} role="user" />
            ))}
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      data-message-id={message.id as unknown as string}
      data-message-role={message.role}
      className={cn('flex flex-col gap-2.5', !compact && 'py-0')}
    >
      {parts.map((part) => (
        <PartView key={partKey(part)} sessionId={sessionId} part={part} role={message.role} />
      ))}
    </article>
  )
}

function PartView({ sessionId, part, role }: { sessionId: SessionId; part: Part; role: UIMessage['role'] }) {
  if (part.type === 'text') return <TextPart part={part} sessionId={sessionId} role={role} />
  if (part.type === 'reasoning') return <ReasoningPart part={part} />
  if (part.type === 'plan') return <PlanPart part={part} />
  if (part.type === 'permission') return <PermissionPart sessionId={sessionId} part={part} />
  if (part.type === 'question') return <QuestionPart sessionId={sessionId} part={part} />
  if (part.type === 'data') {
    return (
      <div className="rounded-md border-[0.5px] border-border bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        <span className="text-foreground/70">{part.name}</span>
        <span className="mx-1.5 text-muted-foreground/60">·</span>
        <code>{safeJson(part.value)}</code>
      </div>
    )
  }
  const tool = asToolPart(part)
  if (tool) return <ToolCallPart part={tool} />
  return null
}

function partKey(part: Part): string {
  if ('toolCallId' in part) return `${part.type}-${part.toolCallId as unknown as string}`
  if ('requestId' in part) return `${part.type}-${part.requestId as unknown as string}`
  if ('questionId' in part) return `${part.type}-${part.questionId as unknown as string}`
  if ('id' in part && typeof part.id === 'string') return `${part.type}-${part.id}`
  return `${part.type}-${part.index}`
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
