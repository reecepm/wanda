import { cn } from '@/shared/utils'
import type { WorkenvRuntime } from '@/types/schema'

const LABELS: Record<WorkenvRuntime, string> = {
  orbstack: 'OrbStack',
}

const STYLES: Record<WorkenvRuntime, string> = {
  orbstack: 'border-indigo-900/60 bg-indigo-950/40 text-indigo-300',
}

/**
 * Compact visual badge for the runtime adapter backing a workenv.
 * Per-runtime colour so it registers at a glance in lists alongside the
 * state pill.
 */
export function WorkenvAdapterBadge({ runtime, size = 'sm' }: { runtime: WorkenvRuntime; size?: 'sm' | 'md' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-mono uppercase tracking-wide',
        size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[10px]',
        STYLES[runtime],
      )}
    >
      {LABELS[runtime]}
    </span>
  )
}
