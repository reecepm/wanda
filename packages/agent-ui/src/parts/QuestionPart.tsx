// -----------------------------------------------------------------------------
// QuestionPart — agent asking the user something. Option chips + freeform
// input when allowed. Resolution collapses to a one-line answer.
// -----------------------------------------------------------------------------

import type { Part, QuestionAnswer, SessionId } from '@wanda/agent-protocol'
import { useState } from 'react'
import { cn } from '../cn'
import { useAgentTransport } from '../context'
import { IconCheck } from '../ui/icons'
import { PillButton } from '../ui/PillButton'

type QuestionPartT = Extract<Part, { type: 'question' }>

export function QuestionPart({ sessionId, part }: { sessionId: SessionId; part: QuestionPartT }) {
  const transport = useAgentTransport()
  const [busy, setBusy] = useState(false)
  const [freeform, setFreeform] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resolved = part.answer != null

  async function respond(answer: QuestionAnswer) {
    setBusy(true)
    setError(null)
    try {
      await transport.respondQuestion({
        sessionId,
        questionId: part.questionId as unknown as string,
        answer,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (resolved) {
    const a = part.answer!
    const label = a.kind === 'option' ? (part.options?.find((o) => o.id === a.optionId)?.label ?? a.optionId) : a.text
    return (
      <div className="flex items-center gap-2 border-l-2 border-border bg-muted/20 px-3 py-1.5 text-[12px] text-muted-foreground">
        <IconCheck className="text-emerald-500 dark:text-emerald-400" />
        <span className="truncate">
          <span className="text-foreground/80">{part.question}</span>
          <span className="mx-2 text-muted-foreground/60">·</span>
          <span className="text-foreground">{label}</span>
        </span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative rounded-md border-[0.5px] border-sky-500/30 bg-sky-500/[0.05]',
        'dark:border-sky-400/25 dark:bg-sky-400/[0.04]',
      )}
    >
      <div className="absolute inset-y-0 left-0 w-[3px] rounded-l-md bg-sky-400/90" aria-hidden />
      <div className="px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.16em] text-sky-700 dark:text-sky-300">Question</div>
        <p className="mt-1 text-[13px] font-medium text-foreground">{part.question}</p>

        {part.options && part.options.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {part.options.map((opt) => (
              <PillButton
                key={opt.id}
                variant="outline"
                size="md"
                disabled={busy}
                onClick={() => respond({ kind: 'option', optionId: opt.id })}
                title={opt.description}
              >
                {opt.label}
              </PillButton>
            ))}
          </div>
        )}

        {part.allowFreeform && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!freeform.trim()) return
              respond({ kind: 'freeform', text: freeform })
            }}
          >
            <input
              className="flex-1 rounded-md border-[0.5px] border-border bg-background/60 px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              placeholder="Your answer…"
              disabled={busy}
            />
            <PillButton type="submit" variant="solid" size="md" disabled={busy || freeform.trim().length === 0}>
              Send
            </PillButton>
          </form>
        )}

        {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      </div>
    </div>
  )
}
