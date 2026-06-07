import { cn } from '@/shared/utils'
import type { WorkenvState } from '@/types/schema'
import { WORKENV_STATE_BADGE_COLORS, WORKENV_STATE_DOT_COLORS, WORKENV_STATE_LABELS } from '../utils/workenv-state'

export function WorkenvStateBadge({
  state,
  size = 'sm',
  className,
}: {
  state: WorkenvState
  size?: 'sm' | 'md'
  className?: string
}) {
  const sizeClass = size === 'md' ? 'text-xs px-2 py-0.5 gap-1.5' : 'text-[10px] px-1.5 py-0.5 gap-1'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded border font-medium',
        sizeClass,
        WORKENV_STATE_BADGE_COLORS[state],
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full shrink-0', WORKENV_STATE_DOT_COLORS[state])} />
      {WORKENV_STATE_LABELS[state]}
    </span>
  )
}
