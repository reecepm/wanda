// -----------------------------------------------------------------------------
// PlanPart — agent task list. Designed as a todo-style block that updates
// in place as statuses change.
// -----------------------------------------------------------------------------

import type { Part, PlanItemStatus } from '@wanda/agent-protocol'
import { cn } from '../cn'

const STATUS_GLYPH: Record<PlanItemStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  failed: '✗',
  skipped: '⊘',
}

const STATUS_COLOR: Record<PlanItemStatus, string> = {
  pending: 'text-muted-foreground/70',
  in_progress: 'text-foreground',
  completed: 'text-emerald-500 dark:text-emerald-400',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground/50',
}

const STATUS_TEXT: Record<PlanItemStatus, string> = {
  pending: 'text-muted-foreground',
  in_progress: 'text-foreground',
  completed: 'line-through decoration-foreground/30 text-muted-foreground',
  failed: 'text-destructive',
  skipped: 'line-through text-muted-foreground/60',
}

export function PlanPart({ part }: { part: Extract<Part, { type: 'plan' }> }) {
  const done = part.plan.filter((p) => p.status === 'completed').length
  const total = part.plan.length
  return (
    <section className="rounded-md border-[0.5px] border-border bg-muted/20 text-[12px]">
      <header className="flex items-center justify-between border-b-[0.5px] border-border px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Plan</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {done}/{total}
        </span>
      </header>
      <ul className="px-3 py-2">
        {part.plan.map((item) => (
          <li key={item.id as unknown as string} className="flex items-start gap-2.5 py-0.5 leading-[1.55]">
            <span className={cn('mt-px font-mono text-[14px] leading-none', STATUS_COLOR[item.status])}>
              {STATUS_GLYPH[item.status]}
            </span>
            <span className={cn('flex-1', STATUS_TEXT[item.status])}>{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
