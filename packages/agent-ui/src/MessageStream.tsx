// -----------------------------------------------------------------------------
// MessageStream — the scrollable turn-by-turn reading surface.
//
// Iterates committed messages sequentially and groups consecutive assistant
// messages under a single `Rail` (an accent stripe that visually binds a
// turn's reasoning + tools + text into one unit). The active streaming tail
// is attached inside the currently running group.
// -----------------------------------------------------------------------------

import type { MessageId, SessionId, UIMessage } from '@wanda/agent-protocol'
import { useEffect, useRef } from 'react'
import { cn } from './cn'
import { useAgentMessages, useAgentSession } from './hooks/useAgentMessages'
import { MessageBubble } from './parts/Message'
import { StreamingTail } from './StreamingTail'
import { Rail } from './ui/Rail'
import { Shimmer } from './ui/Shimmer'
import { TurnStamp } from './ui/TurnStamp'

interface AssistantGroup {
  kind: 'assistant'
  messages: UIMessage[]
  firstId: MessageId
  lastId: MessageId
}
interface UserGroup {
  kind: 'user' | 'system'
  message: UIMessage
}
type Group = AssistantGroup | UserGroup

function hasRenderableAssistantContent(message: UIMessage, activeMessageId: MessageId | null): boolean {
  return message.parts.length > 0 || activeMessageId === message.id
}

function group(messages: ReadonlyArray<UIMessage>): Group[] {
  const out: Group[] = []
  let current: AssistantGroup | null = null
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (current == null) {
        current = {
          kind: 'assistant',
          messages: [m],
          firstId: m.id,
          lastId: m.id,
        }
        out.push(current)
      } else {
        current.messages.push(m)
        current.lastId = m.id
      }
    } else {
      current = null
      out.push({ kind: m.role, message: m })
    }
  }
  return out
}

export function MessageStream({ sessionId, className }: { sessionId: SessionId; className?: string }) {
  const messages = useAgentMessages(sessionId)
  const session = useAgentSession(sessionId)
  const groups = group(messages)
  const activeMessageId = session.activeAssistantMessageId

  // Autoscroll to bottom on new messages / streaming ticks when the user is
  // already near the bottom. If they've scrolled up to read, don't yank them.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lastLenRef = useRef(messages.length)
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    const grew = messages.length > lastLenRef.current
    lastLenRef.current = messages.length
    if (nearBottom || grew) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages])

  const running = session.status === 'running'

  return (
    <div ref={scrollerRef} className={cn('mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6', className)}>
      {groups.length === 0 && <EmptyState running={running} />}
      {groups.map((g, i) => {
        const last = i === groups.length - 1
        if (g.kind !== 'assistant') {
          return <MessageBubble key={g.message.id as unknown as string} sessionId={sessionId} message={g.message} />
        }
        const isActive = last && running
        const activeInGroup = activeMessageId ? g.messages.some((m) => m.id === activeMessageId) : false
        const renderableMessages = g.messages.filter((m) => hasRenderableAssistantContent(m, activeMessageId))
        if (renderableMessages.length === 0 && !activeInGroup) return null
        return (
          <div key={`${g.firstId as unknown as string}-grp`} className="flex flex-col gap-2.5">
            <Rail state={isActive ? 'running' : 'idle'}>
              <div className="flex flex-col gap-3">
                {renderableMessages.map((m) => (
                  <div key={m.id as unknown as string} className="flex flex-col gap-2.5">
                    <MessageBubble sessionId={sessionId} message={m} compact />
                    {activeMessageId === m.id && (
                      <>
                        <StreamingTail sessionId={sessionId} messageId={m.id} kind="reasoning" />
                        <StreamingTail sessionId={sessionId} messageId={m.id} kind="text" />
                      </>
                    )}
                  </div>
                ))}
                {isActive && !activeInGroup && <PendingHint />}
              </div>
            </Rail>
            {!last && (
              <TurnStamp
                label={`turn · ${renderableMessages.length} message${renderableMessages.length === 1 ? '' : 's'}${
                  session.modelId ? ` · ${session.modelId as unknown as string}` : ''
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function PendingHint() {
  return (
    <div className="flex h-7 items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
      <Shimmer>Working</Shimmer>
    </div>
  )
}

function EmptyState({ running }: { running: boolean }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
      <div className="max-w-sm text-[12px] leading-[1.7] text-muted-foreground">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">Session ready</p>
        <p>
          {running
            ? 'The agent is warming up…'
            : 'Type a prompt below. Attachments can be pasted or dropped onto the composer.'}
        </p>
      </div>
    </div>
  )
}
