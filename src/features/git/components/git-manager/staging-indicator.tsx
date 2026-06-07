import { FILE_STATUS_COLORS, FILE_STATUS_LABELS, type FileStatus } from '@/features/git/utils/git-status'
import { RiCheckLine } from '@/lib/icons'
import { cn } from '@/shared/utils'

const UNSTAGED_COLORS: Record<string, string> = {
  added: 'border-emerald-500/60 text-emerald-500 hover:bg-emerald-500/15',
  modified: 'border-amber-500/60 text-amber-500 hover:bg-amber-500/15',
  deleted: 'border-red-500/60 text-red-500 hover:bg-red-500/15',
  renamed: 'border-blue-500/60 text-blue-500 hover:bg-blue-500/15',
  untracked: 'border-zinc-500/60 text-zinc-500 hover:bg-zinc-500/15',
}

interface StagingIndicatorProps {
  staged: boolean
  status: FileStatus
  onClick: () => void
}

export function StagingIndicator({ staged, status, onClick }: StagingIndicatorProps) {
  if (staged) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className="shrink-0 flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
        title="Unstage"
      >
        <RiCheckLine className="h-2.5 w-2.5" />
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        'shrink-0 flex items-center justify-center w-4 h-4 rounded-full border bg-transparent transition-colors',
        UNSTAGED_COLORS[status] ?? UNSTAGED_COLORS.modified,
      )}
      title="Stage"
    >
      <span className={cn('text-[8px] font-mono font-bold', FILE_STATUS_COLORS[status])}>
        {FILE_STATUS_LABELS[status]}
      </span>
    </button>
  )
}
