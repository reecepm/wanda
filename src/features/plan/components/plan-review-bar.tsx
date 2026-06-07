import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RiCheckLine, RiCloseCircleLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import type { PlanWithMeta } from '../../../../shared/contracts/domain-types'

export function PlanReviewBar({ plan }: { plan: PlanWithMeta }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [composing, setComposing] = useState<'approve' | 'changes' | null>(null)

  const { data: comments = [] } = useQuery(orpcUtils.plan.listComments.queryOptions({ input: { planId: plan.id } }))

  const includedCount = comments.filter((c) => c.includeInFeedback && c.resolvedAt == null).length

  const resolveMutation = useMutation({
    ...orpcUtils.plan.resolveReview.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.plan.get.key({ input: { id: plan.id } }) })
      queryClient.invalidateQueries({ queryKey: orpcUtils.plan.list.key() })
      setComposing(null)
      setNote('')
    },
  })

  // Only render the bar for unresolved review-loop plans.
  if (plan.submittedByChatSessionId == null || plan.status !== 'draft') return null

  return (
    <div className="border-b border-violet-900/40 bg-violet-950/20">
      <div className="flex items-center gap-3 px-6 py-2">
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300">
          Review pending
        </span>
        <span className="text-[11px] text-zinc-400">
          Submitted by chat session{' '}
          <code className="rounded bg-zinc-800/60 px-1 text-zinc-300">
            {plan.submittedByChatSessionId.slice(0, 12)}
          </code>
        </span>
        <span className="text-[11px] text-zinc-500">
          · {includedCount} comment{includedCount === 1 ? '' : 's'} will be sent
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setComposing('changes')}
            disabled={resolveMutation.isPending}
          >
            <RiCloseCircleLine className="h-3.5 w-3.5" />
            Request changes
          </Button>
          <Button size="sm" onClick={() => setComposing('approve')} disabled={resolveMutation.isPending}>
            <RiCheckLine className="h-3.5 w-3.5" />
            Approve
          </Button>
        </div>
      </div>

      {composing && (
        <div className="border-t border-violet-900/40 bg-zinc-950/40 px-6 py-3">
          <label className="mb-1 block text-[10px] font-medium text-zinc-500">
            {composing === 'approve' ? 'Approval note (optional)' : 'What needs to change?'}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              composing === 'approve'
                ? 'Looks good, ship it.'
                : 'Re-scope the auth section, address comments, then resubmit.'
            }
            rows={2}
            autoFocus
            className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setComposing(null)
                setNote('')
              }}
              disabled={resolveMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                resolveMutation.mutate({
                  planId: plan.id,
                  decision: composing === 'approve' ? 'approved' : 'changes_requested',
                  userNote: note.trim() || null,
                })
              }
              disabled={resolveMutation.isPending}
            >
              {composing === 'approve' ? 'Send approval' : 'Send changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
