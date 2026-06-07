import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ContentTopBar } from '@/layout/content-top-bar'
import { RiAlertLine, RiArrowLeftLine, RiDeleteBin6Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { PlanEditor } from './plan-editor'
import { PlanReviewBar } from './plan-review-bar'
import { PlanLinkAddButton, PlanSidePanel } from './plan-side-panel'
import { PlanStatusControl } from './plan-status-control'
import { PlanTtlControl } from './plan-ttl-control'

export function PlanEditorScreen({ planId }: { planId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: plan, isLoading } = useQuery(orpcUtils.plan.get.queryOptions({ input: { id: planId } }))

  const setStatusMutation = useMutation({
    ...orpcUtils.plan.setStatus.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.plan.get.key({ input: { id: planId } }) })
      queryClient.invalidateQueries({ queryKey: orpcUtils.plan.list.key() })
    },
  })

  if (isLoading) {
    return <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">Loading...</div>
  }
  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-zinc-950 text-zinc-400">
        <p className="text-sm">Plan not found.</p>
        <Link to="/plans" className="text-xs text-zinc-500 underline-offset-2 hover:underline">
          Back to plans
        </Link>
      </div>
    )
  }

  async function handleDelete() {
    if (!plan) return
    if (!window.confirm(`Delete "${plan.title}"? This is permanent.`)) return
    await orpcUtils.plan.delete.call({ id: planId })
    queryClient.invalidateQueries({ queryKey: orpcUtils.plan.list.key() })
    navigate({ to: '/plans' })
  }

  return (
    <div className="flex h-full flex-col">
      <ContentTopBar>
        <ContentTopBar.Left>
          <Link
            to="/plans"
            aria-label="Back to plans"
            className="flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-300"
          >
            <RiArrowLeftLine className="h-3.5 w-3.5" />
            Plans
          </Link>
          <span className="text-zinc-700">/</span>
          <span className="max-w-md truncate font-medium text-[13px] text-zinc-300">{plan.title}</span>
          <PlanStatusControl
            status={plan.status}
            disabled={setStatusMutation.isPending}
            onChange={(status) => setStatusMutation.mutate({ id: planId, status })}
          />
          <span className="text-[10px] text-zinc-600 uppercase tracking-wide">{plan.kind}</span>
          <span className="text-[10px] text-zinc-600">v{plan.version}</span>
          <PlanTtlControl planId={plan.id} expectedVersion={plan.version} staleAfterDays={plan.staleAfterDays} />
        </ContentTopBar.Left>
        <ContentTopBar.Right>
          <PlanLinkAddButton planId={planId} />
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <RiDeleteBin6Line className="h-3.5 w-3.5" />
          </Button>
        </ContentTopBar.Right>
      </ContentTopBar>

      <PlanReviewBar plan={plan} />

      {plan.staleness.isStale && (
        <div className="flex items-center gap-2 border-amber-900/40 border-b bg-amber-950/30 px-6 py-1.5 text-[11px] text-amber-300">
          <RiAlertLine className="h-3.5 w-3.5" />
          <span>
            {plan.staleness.reason === 'never_reviewed' && 'No human review yet - agents will see a stale warning.'}
            {plan.staleness.reason === 'inactive_status' && (
              <>
                This plan is <strong>{plan.status}</strong> and excluded from agent search by default.
              </>
            )}
            {plan.staleness.reason === 'past_ttl' && (
              <>Stale: last human review was {plan.staleness.ageDays} days ago.</>
            )}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <PlanEditor planId={planId} />
          </div>
        </div>
        <aside className="w-72 shrink-0 border-zinc-800/60 border-l bg-zinc-950/40">
          <PlanSidePanel plan={plan} />
        </aside>
      </div>
    </div>
  )
}
