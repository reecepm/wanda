import { RiCheckLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import type { PlanStatus } from '../../../../shared/contracts/domain-types'

const STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
  superseded: 'Superseded',
}

const STATUS_STYLES: Record<PlanStatus, string> = {
  draft: 'bg-zinc-700/40 text-zinc-300',
  active: 'bg-emerald-500/15 text-emerald-300',
  completed: 'bg-blue-500/15 text-blue-300',
  archived: 'bg-zinc-700/30 text-zinc-500',
  superseded: 'bg-amber-500/15 text-amber-300',
}

const STATUS_ORDER: PlanStatus[] = ['draft', 'active', 'completed', 'superseded', 'archived']

export function PlanStatusBadge({ status, className }: { status: PlanStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
        STATUS_STYLES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

export function PlanStatusControl({
  status,
  onChange,
  disabled,
}: {
  status: PlanStatus
  onChange: (next: PlanStatus) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium outline-none transition-colors',
          STATUS_STYLES[status],
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:brightness-110',
        )}
      >
        {STATUS_LABELS[status]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {STATUS_ORDER.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => {
              if (s !== status) onChange(s)
            }}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span>{STATUS_LABELS[s]}</span>
            {s === status && <RiCheckLine className="h-3.5 w-3.5 text-zinc-400" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
