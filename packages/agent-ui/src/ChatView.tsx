// -----------------------------------------------------------------------------
// ChatView — the top-level chat surface.
//
// Composed from `Chat.*` primitives so consumers can rearrange or swap the
// pieces. The default export wires the canonical layout:
//
//   <Chat.Root>
//     <Chat.Header />
//     <Chat.Stream />
//     <Chat.Composer />
//   </Chat.Root>
//
// Each primitive is exported independently for bespoke compositions.
// -----------------------------------------------------------------------------

import type { SessionId } from '@wanda/agent-protocol'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { cn } from './cn'
import {
  Composer,
  ComposerModelPicker,
  ComposerModePicker,
  ComposerReasoningPicker,
  ComposerReviewButton,
} from './composer/Composer'
import { useAgentLastError, useAgentSession } from './hooks/useAgentMessages'
import { MessageStream } from './MessageStream'
import { Shimmer } from './ui/Shimmer'

// -----------------------------------------------------------------------------
// Context — so Chat.* primitives can share the ambient sessionId without
// threading it through every prop. The public ChatView still accepts
// sessionId as a prop to stay backwards-compatible.
// -----------------------------------------------------------------------------

interface ChatRootCtx {
  readonly sessionId: SessionId
}

const ChatRootContext = createContext<ChatRootCtx | null>(null)

function useChatSessionId(local?: SessionId): SessionId {
  const ctx = useContext(ChatRootContext)
  if (local) return local
  if (!ctx) throw new Error('Chat.* primitives must be used inside <Chat.Root>.')
  return ctx.sessionId
}

// -----------------------------------------------------------------------------
// Chat.Root — ambient provider + outer flex column.
// -----------------------------------------------------------------------------

function Root({ sessionId, className, children }: { sessionId: SessionId; className?: string; children: ReactNode }) {
  const value = useMemo(() => ({ sessionId }), [sessionId])
  return (
    <ChatRootContext.Provider value={value}>
      <div className={cn('flex h-full min-h-0 flex-col bg-background text-foreground', className)}>{children}</div>
    </ChatRootContext.Provider>
  )
}

// -----------------------------------------------------------------------------
// Chat.Header — slim session strip. Status + meta + ambient pickers.
// -----------------------------------------------------------------------------

function Header({
  sessionId: localId,
  className,
  children,
}: {
  sessionId?: SessionId
  className?: string
  children?: ReactNode
}) {
  const sessionId = useChatSessionId(localId)
  return (
    <header
      className={cn(
        'flex h-10 items-center gap-3 border-b-[0.5px] border-border bg-background/60 px-4',
        'backdrop-blur',
        className,
      )}
    >
      <HeaderSessionBadge sessionId={sessionId} />
      <div className="ml-auto flex items-center gap-1.5">
        {children ?? <DefaultHeaderActions sessionId={sessionId} />}
      </div>
    </header>
  )
}

function HeaderSessionBadge({ sessionId }: { sessionId: SessionId }) {
  const session = useAgentSession(sessionId)
  const shortId = (sessionId as unknown as string).slice(0, 8)
  const statusLabel: Record<typeof session.status, string> = {
    starting: 'starting',
    ready: 'ready',
    running: 'thinking',
    closed: 'closed',
  }
  const statusColor: Record<typeof session.status, string> = {
    starting: 'text-muted-foreground',
    ready: 'text-emerald-500 dark:text-emerald-400',
    running: 'text-foreground',
    closed: 'text-muted-foreground/60',
  }
  return (
    <div className="flex min-w-0 items-center gap-3 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">session</span>
        <span className="font-mono text-[11px] text-foreground/80">{shortId}</span>
      </div>
      {session.providerId && (
        <span className="truncate rounded-full border-[0.5px] border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {session.providerId as unknown as string}
        </span>
      )}
      <span
        className={cn(
          'flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em]',
          statusColor[session.status],
        )}
      >
        <span
          aria-hidden
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            session.status === 'ready' && 'bg-emerald-500 dark:bg-emerald-400',
            session.status === 'running' && 'bg-foreground [animation:agent-dot-ping_1.2s_ease-in-out_infinite]',
            session.status === 'closed' && 'bg-muted-foreground/60',
            session.status === 'starting' && 'bg-muted-foreground',
          )}
        />
        {session.status === 'running' ? <Shimmer>{statusLabel[session.status]}</Shimmer> : statusLabel[session.status]}
      </span>
    </div>
  )
}

function DefaultHeaderActions({ sessionId }: { sessionId: SessionId }) {
  return (
    <>
      <ComposerModePicker sessionId={sessionId} />
      <ComposerModelPicker sessionId={sessionId} />
      <ComposerReasoningPicker sessionId={sessionId} />
    </>
  )
}

// -----------------------------------------------------------------------------
// Chat.Stream — scroll container + MessageStream.
// -----------------------------------------------------------------------------

function Stream({ sessionId: localId, className }: { sessionId?: SessionId; className?: string }) {
  const sessionId = useChatSessionId(localId)
  return (
    <div className={cn('flex-1 min-h-0 overflow-y-auto', className)}>
      <MessageStream sessionId={sessionId} />
      <ErrorBanner sessionId={sessionId} />
    </div>
  )
}

/**
 * Renders the session's most recent error as a dismissable banner.
 * Before this component existed, `error` events landed in
 * `state.lastError` but no UI read the field — a failed turn looked
 * identical to a successful one with no reply, leaving the user to
 * stare at an empty chat. Rendering here covers both the in-turn error
 * path (Codex `error` notification / turn.status=failed) and any
 * runtime `error` event emitted by the turn-runner.
 */
function ErrorBanner({ sessionId }: { sessionId: SessionId }) {
  const err = useAgentLastError(sessionId)
  if (!err) return null
  return (
    <div className="mx-auto my-3 w-full max-w-3xl px-5">
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      >
        <p className="font-medium">{err.recoverable ? 'Agent hit a recoverable error' : 'Agent failed'}</p>
        <p className="mt-1 font-mono text-xs opacity-90">
          {err.code ? `[${err.code}] ` : ''}
          {err.message || '(no message)'}
        </p>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Chat.Composer — composer with its default toolbar.
// -----------------------------------------------------------------------------

function ComposerDock({
  sessionId: localId,
  className,
  placeholder,
  showModePicker = true,
  showModelPicker = true,
}: {
  sessionId?: SessionId
  className?: string
  placeholder?: string
  showModePicker?: boolean
  showModelPicker?: boolean
}) {
  const sessionId = useChatSessionId(localId)
  return (
    <div className={cn('mx-auto w-full max-w-3xl px-5 pb-4 pt-2', className)}>
      <Composer
        sessionId={sessionId}
        placeholder={placeholder}
        extraToolbarLeft={
          <>
            {showModePicker && <ComposerModePicker sessionId={sessionId} />}
            {showModelPicker && <ComposerModelPicker sessionId={sessionId} />}
            <ComposerReasoningPicker sessionId={sessionId} />
            <ComposerReviewButton sessionId={sessionId} />
          </>
        }
      />
    </div>
  )
}

// -----------------------------------------------------------------------------
// Public namespace + default composition
// -----------------------------------------------------------------------------

export const Chat = {
  Root,
  Header,
  Stream,
  Composer: ComposerDock,
}

export function ChatView({ sessionId, className }: { sessionId: SessionId; className?: string }) {
  return (
    <Chat.Root sessionId={sessionId} className={className}>
      <Chat.Stream />
      <Chat.Composer />
    </Chat.Root>
  )
}
