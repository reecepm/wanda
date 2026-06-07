// -----------------------------------------------------------------------------
// ReasoningPart — collapsible reasoning block. Auto-collapses when the
// reasoning has finished streaming, expanded-by-default while active.
// -----------------------------------------------------------------------------

import type { Part } from '@wanda/agent-protocol'
import { useEffect, useState } from 'react'
import { cn } from '../cn'
import { IconBrain, IconChevronDown, IconChevronRight } from '../ui/icons'
import { Shimmer } from '../ui/Shimmer'

export function ReasoningPart({ part }: { part: Extract<Part, { type: 'reasoning' }> }) {
  const streaming = part.state === 'streaming'
  const [open, setOpen] = useState<boolean>(streaming)

  // Auto-collapse on completion, but leave it open if the user manually
  // opened it. Simple heuristic: if the user clicked close while streaming,
  // respect that; otherwise auto-follow the streaming state.
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched) return
    setOpen(streaming)
  }, [streaming, touched])

  return (
    <div className="text-muted-foreground">
      <button
        type="button"
        onClick={() => {
          setTouched(true)
          setOpen((o) => !o)
        }}
        className={cn('flex h-7 items-center gap-2 text-[11px] uppercase tracking-[0.12em]', 'hover:text-foreground')}
      >
        <span className="text-foreground/60">{open ? <IconChevronDown /> : <IconChevronRight />}</span>
        <IconBrain className="text-foreground/60" />
        {streaming ? <Shimmer>Thinking</Shimmer> : <span>Thought</span>}
        {!open && part.text.length > 0 && (
          <span className="truncate font-sans normal-case tracking-normal text-muted-foreground/80">
            · {truncate(part.text, 60)}
          </span>
        )}
      </button>
      {open && part.text.length > 0 && (
        <div className="mt-1 whitespace-pre-wrap border-l border-border/70 pl-3 text-[12px] italic leading-[1.65] text-muted-foreground">
          {part.text}
        </div>
      )}
    </div>
  )
}

function truncate(s: string, n: number): string {
  const cleaned = s.replace(/\s+/g, ' ').trim()
  return cleaned.length > n ? `${cleaned.slice(0, n)}…` : cleaned
}
