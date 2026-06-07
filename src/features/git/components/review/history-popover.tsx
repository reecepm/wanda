import { useState } from 'react'
import { useResolutionStatus, useReviews } from '@/features/git/hooks/use-review'
import { RiFileLine, RiHistoryLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import type { CommentResolution, ReviewCommentWithResolution } from '@/types/schema'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'

interface ReviewHistoryPopoverProps {
  podId: string
}

const RESOLUTION_DOT: Record<CommentResolution, string> = {
  unresolved: 'bg-amber-400',
  changed: 'bg-sky-400',
  resolved: 'bg-emerald-400',
  unknown: 'bg-zinc-500',
}

const RESOLUTION_LABEL: Record<CommentResolution, string> = {
  unresolved: 'Unresolved',
  changed: 'Changed',
  resolved: 'Resolved',
  unknown: 'Unknown',
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ReviewHistoryPopover({ podId }: ReviewHistoryPopoverProps) {
  const { reviews } = useReviews(podId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const submitted = reviews.filter((r) => r.state === 'submitted')

  return (
    <Popover>
      <PopoverTrigger
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
        title="Review history"
      >
        <RiHistoryLine className="h-3 w-3" />
        History
        {submitted.length > 0 && <span className="text-[10px] text-zinc-500">({submitted.length})</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 bg-zinc-900 border-zinc-800">
        <div className="px-3 py-2 border-b border-zinc-800">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Past reviews</span>
        </div>
        {submitted.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-zinc-500">No submitted reviews yet.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {submitted.map((r) => {
              const expanded = expandedId === r.id
              return (
                <div key={r.id} className="border-b border-zinc-800 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors',
                      expanded && 'bg-zinc-800/30',
                    )}
                  >
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="text-[11px] text-zinc-200">
                        {r.submittedAt ? formatDate(r.submittedAt) : '—'}
                      </span>
                      {r.headCommit && (
                        <span className="text-[10px] text-zinc-500 font-mono truncate">{r.headCommit.slice(0, 7)}</span>
                      )}
                    </div>
                    {r.summary && <span className="text-[10px] text-zinc-500 truncate max-w-[120px]">{r.summary}</span>}
                  </button>
                  {expanded && <ReviewHistoryComments reviewId={r.id} />}
                </div>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ReviewHistoryComments({ reviewId }: { reviewId: string }) {
  const { comments, isLoading } = useResolutionStatus(reviewId)

  if (isLoading) {
    return <div className="px-3 py-2 text-[10px] text-zinc-500">Computing status...</div>
  }
  if (!comments || comments.length === 0) {
    return <div className="px-3 py-2 text-[10px] text-zinc-500">No comments.</div>
  }

  const byFile = new Map<string, ReviewCommentWithResolution[]>()
  for (const c of comments) {
    const list = byFile.get(c.filePath) ?? []
    list.push(c)
    byFile.set(c.filePath, list)
  }

  return (
    <div className="px-3 py-2 flex flex-col gap-2 bg-zinc-950/40">
      {[...byFile.entries()].map(([filePath, list]) => (
        <div key={filePath} className="flex flex-col gap-1">
          <div className="flex items-center gap-1 text-[10px] text-zinc-400">
            <RiFileLine className="h-2.5 w-2.5" />
            <span className="font-mono truncate">{filePath}</span>
          </div>
          {list.map((c) => {
            const lineRef = c.endLine ? `${c.startLine}-${c.endLine}` : `${c.startLine}`
            return (
              <div key={c.id} className="flex items-start gap-2 pl-3 border-l border-zinc-800 py-0.5">
                <span
                  className={cn('mt-1 w-1.5 h-1.5 rounded-full shrink-0', RESOLUTION_DOT[c.resolution])}
                  title={RESOLUTION_LABEL[c.resolution]}
                />
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-[10px] text-zinc-500 font-mono">L{lineRef}</span>
                  <span className="text-[11px] text-zinc-300 leading-tight">{c.body}</span>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
