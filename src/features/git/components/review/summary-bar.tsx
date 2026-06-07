import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useReviewComments, useSubmitReview } from '@/features/git/hooks/use-review'
import { useReviewStore } from '@/features/git/store/review-store'
import { RiCheckDoubleLine, RiSendPlaneLine } from '@/lib/icons'
import { ReviewHistoryPopover } from './history-popover'
import { SendToAgentDialog } from './send-to-agent-dialog'

interface ReviewSummaryBarProps {
  podId: string
  branch?: string
  baseBranch?: string
}

export function ReviewSummaryBar({ podId, branch, baseBranch }: ReviewSummaryBarProps) {
  const activeReviewId = useReviewStore((s) => s.activeReviewId)
  const { comments } = useReviewComments(activeReviewId)
  const submit = useSubmitReview(podId)
  const [dialogOpen, setDialogOpen] = useState(false)

  const handleSubmit = useCallback(() => {
    if (!activeReviewId) return
    if (comments.length === 0) return
    if (
      !window.confirm(
        `Submit review with ${comments.length} comment${comments.length === 1 ? '' : 's'}? A new draft will start for any further comments.`,
      )
    ) {
      return
    }
    submit.mutate(
      { reviewId: activeReviewId },
      {
        onSuccess: () => toast.success('Review submitted'),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to submit review'),
      },
    )
  }, [activeReviewId, comments.length, submit])

  return (
    <div className="flex items-center gap-1.5">
      {comments.length > 0 && (
        <span className="text-[10px] font-medium text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded">
          {comments.length} comment{comments.length !== 1 ? 's' : ''}
        </span>
      )}

      <ReviewHistoryPopover podId={podId} />

      <button
        type="button"
        onClick={handleSubmit}
        disabled={comments.length === 0 || submit.isPending}
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
        title="Freeze this review and start a fresh draft"
      >
        <RiCheckDoubleLine className="h-3 w-3" />
        {submit.isPending ? 'Submitting...' : 'Submit'}
      </button>

      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={comments.length === 0}
        className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
      >
        <RiSendPlaneLine className="h-3 w-3" />
        Send to Agent
      </button>

      <SendToAgentDialog
        podId={podId}
        branch={branch}
        baseBranch={baseBranch}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
