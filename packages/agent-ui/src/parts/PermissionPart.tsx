// -----------------------------------------------------------------------------
// PermissionPart — the permission gate. Amber side-accent while unresolved,
// collapsed to a one-line summary after resolution. Enter / Escape wire
// directly to the primary allow / deny actions.
// -----------------------------------------------------------------------------

import type { Decision, Part, PermissionAction, SessionId } from '@wanda/agent-protocol'
import { useEffect, useRef, useState } from 'react'
import { cn } from '../cn'
import { useAgentTransport } from '../context'
import { CodeInk } from '../ui/CodeInk'
import { IconCheck, IconX } from '../ui/icons'
import { Kbd } from '../ui/Kbd'
import { PillButton } from '../ui/PillButton'

type PermissionPartT = Extract<Part, { type: 'permission' }>

const DEFAULT_ACTIONS: PermissionAction[] = [
  { id: 'allow_once', label: 'Allow once', behaviour: 'allow', scope: 'once' },
  { id: 'allow_session', label: 'Allow for session', behaviour: 'allow', scope: 'session' },
  { id: 'deny_once', label: 'Deny', behaviour: 'deny', scope: 'once' },
]

function detailSummary(req: Extract<PermissionPartT['request'], { kind: 'tool' }>): string | null {
  switch (req.detail.kind) {
    case 'shell':
      return req.detail.command
    case 'diff':
      return req.detail.path
    case 'read':
      return req.detail.path
    case 'search':
      return req.detail.query
    case 'fetch':
      return `${req.detail.method} ${req.detail.url}`
    case 'terminal':
      return req.detail.label ?? req.detail.terminalId
    case 'think':
      return req.detail.topic ?? null
    case 'other':
      return req.detail.toolName
    default:
      return null
  }
}

export function PermissionPart({ sessionId, part }: { sessionId: SessionId; part: PermissionPartT }) {
  const transport = useAgentTransport()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resolved = part.resolution != null
  const primaryRef = useRef<HTMLButtonElement>(null)

  const req = part.request
  const toolDetail = req.kind === 'tool' ? detailSummary(req) : null
  const actions: ReadonlyArray<PermissionAction> =
    req.kind === 'tool' && req.actions && req.actions.length > 0 ? req.actions : DEFAULT_ACTIONS

  const primary = actions.find((a) => a.behaviour === 'allow') ?? actions[0]
  const deny = actions.find((a) => a.behaviour === 'deny')

  async function respond(action: PermissionAction) {
    setBusy(true)
    setError(null)
    const decision: Decision =
      action.behaviour === 'allow'
        ? { behaviour: 'allow', scope: action.scope }
        : {
            behaviour: 'deny',
            scope: action.scope,
          }
    try {
      await transport.respondPermission({
        sessionId,
        requestId: part.requestId as unknown as string,
        decision,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Focus the primary action when the gate appears so Enter resolves.
  useEffect(() => {
    if (!resolved && primaryRef.current) primaryRef.current.focus()
  }, [resolved])

  if (resolved) {
    const allowed = part.resolution!.behaviour === 'allow'
    return (
      <div
        className={cn(
          'flex items-center gap-2 border-l-2 border-border bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground',
        )}
      >
        {allowed ? (
          <IconCheck className="text-emerald-500 dark:text-emerald-400" />
        ) : (
          <IconX className="text-destructive" />
        )}
        <span className="truncate">
          <span className="text-foreground/80">
            {req.kind === 'tool' ? req.title : req.kind === 'plan' ? 'Plan' : 'Permission'}
          </span>
          <span className="mx-2 text-muted-foreground/60">·</span>
          <span className="font-mono text-[11px]">{allowed ? 'allowed' : 'denied'}</span>
          {part.resolution!.behaviour === 'deny' && part.resolution!.message && (
            <span className="text-muted-foreground"> — {part.resolution!.message}</span>
          )}
        </span>
      </div>
    )
  }

  const isShell = req.kind === 'tool' && req.detail.kind === 'shell'

  return (
    <div
      onKeyDown={(e) => {
        if (busy) return
        if (e.key === 'Enter' && primary) {
          e.preventDefault()
          void respond(primary)
        } else if (e.key === 'Escape' && deny) {
          e.preventDefault()
          void respond(deny)
        }
      }}
      className={cn(
        'relative rounded-md border-[0.5px] border-amber-500/35 bg-amber-500/[0.06]',
        'dark:border-amber-400/30 dark:bg-amber-400/[0.05]',
      )}
    >
      <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-md bg-amber-400/90" aria-hidden />
      <div className="px-4 py-3">
        <div className="flex items-baseline gap-2 text-[11px] uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">
          <span>Permission</span>
          <span className="text-amber-600/60 dark:text-amber-400/50">·</span>
          <span className="font-mono">{req.kind === 'tool' ? req.detail.kind : req.kind}</span>
        </div>
        <div className="mt-1 text-[13px] font-medium text-foreground">
          {req.kind === 'tool' && req.title}
          {req.kind === 'plan' && 'Approve plan'}
          {req.kind === 'question' && req.question}
          {req.kind === 'mode' && `Switch mode to ${req.proposedModeId as unknown as string}?`}
          {req.kind === 'other' && req.title}
        </div>
        {toolDetail &&
          (isShell ? (
            <CodeInk className="mt-2" prompt="$">
              {toolDetail}
            </CodeInk>
          ) : (
            <p className="mt-1.5 font-mono text-[12px] text-foreground/80 break-all">{toolDetail}</p>
          ))}
        {req.kind === 'other' && req.description && (
          <p className="mt-1.5 text-[12px] text-muted-foreground">{req.description}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {actions.map((action, i) => {
            const isAllow = action.behaviour === 'allow'
            const variant: 'solid' | 'outline' | 'danger' =
              isAllow && action.scope === 'once' ? 'solid' : isAllow ? 'outline' : 'danger'
            const isPrimary = action === primary
            const isDeny = action === deny
            return (
              <PillButton
                key={action.id}
                ref={isPrimary ? primaryRef : undefined}
                variant={variant}
                size="md"
                disabled={busy || action.disabledReason != null}
                onClick={() => respond(action)}
                title={action.disabledReason}
                trailing={isPrimary ? <Kbd>⏎</Kbd> : isDeny && i === actions.length - 1 ? <Kbd>Esc</Kbd> : undefined}
              >
                {action.label}
              </PillButton>
            )
          })}
        </div>
        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}
