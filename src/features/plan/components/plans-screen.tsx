import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ContentTopBar } from '@/layout/content-top-bar'
import { RiAddLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import type { PlanKind } from '../../../../shared/contracts/domain-types'
import { PlanCreateDialog } from './plan-create-dialog'
import { PlanList } from './plan-list'

type KindFilter = PlanKind | 'all'

/** Mirrors server's deriveStaleness for active plans, which are the only plans in the default list. */
function isStale(plan: { status: string; lastHumanReviewAt: number | null; staleAfterDays: number | null }): boolean {
  if (plan.status !== 'active') return false
  if (plan.lastHumanReviewAt == null) return true
  if (plan.staleAfterDays == null) return false
  const ageDays = (Date.now() - plan.lastHumanReviewAt) / 86_400_000
  return ageDays > plan.staleAfterDays
}

export function PlansScreen() {
  const [creating, setCreating] = useState(false)
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [showAll, setShowAll] = useState(false)
  const [staleOnly, setStaleOnly] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: workspaces = [] } = useQuery(orpcUtils.workspace.list.queryOptions())
  const { data: plans = [] } = useQuery(orpcUtils.plan.list.queryOptions({ input: { includeNonCanonical: showAll } }))

  const staleCount = useMemo(() => plans.filter(isStale).length, [plans])

  const filtered = useMemo(() => {
    let out = plans
    if (kindFilter !== 'all') out = out.filter((plan) => plan.kind === kindFilter)
    if (staleOnly) out = out.filter(isStale)
    return out
  }, [plans, kindFilter, staleOnly])

  const workspaceNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const workspace of workspaces) names.set(workspace.id, workspace.name)
    return names
  }, [workspaces])

  async function handleCreate(input: {
    workspaceId: string
    title: string
    kind: PlanKind
    staleAfterDays: number | null
  }) {
    const plan = await orpcUtils.plan.create.call(input)
    setCreating(false)
    queryClient.invalidateQueries({ queryKey: orpcUtils.plan.list.key() })
    navigate({ to: '/plans/$planId', params: { planId: plan.id } })
  }

  return (
    <div className="flex h-full flex-col">
      <ContentTopBar>
        <ContentTopBar.Left>
          <div role="tablist" aria-label="Plan kinds" className="flex items-center gap-0.5">
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'prd', label: 'PRDs' },
                { value: 'task-plan', label: 'Task plans' },
                { value: 'proposal', label: 'Proposals' },
              ] as { value: KindFilter; label: string }[]
            ).map((tab) => {
              const isActive = kindFilter === tab.value
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setKindFilter(tab.value)}
                  className={`relative rounded-md px-2 py-1 text-[11px] transition-colors ${
                    isActive ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </ContentTopBar.Left>
        <ContentTopBar.Right>
          {staleCount > 0 && (
            <button
              type="button"
              onClick={() => setStaleOnly((value) => !value)}
              className={
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-[10px] transition-colors ' +
                (staleOnly
                  ? 'bg-amber-500/25 text-amber-300'
                  : 'bg-amber-500/10 text-amber-300/80 hover:bg-amber-500/20')
              }
              title={staleOnly ? 'Showing only stale plans' : 'Filter to stale plans'}
            >
              {staleCount} need{staleCount === 1 ? 's' : ''} review
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => setShowAll(event.target.checked)}
              className="h-3 w-3"
            />
            Include drafts/archived
          </label>
          <Button size="sm" onClick={() => setCreating(true)} disabled={workspaces.length === 0}>
            <RiAddLine className="h-4 w-4" />
            New plan
          </Button>
        </ContentTopBar.Right>
      </ContentTopBar>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <PlanList plans={filtered} workspaceNames={workspaceNames} onCreate={() => setCreating(true)} />
      </div>
      {creating && (
        <PlanCreateDialog workspaces={workspaces} onSubmit={handleCreate} onCancel={() => setCreating(false)} />
      )}
    </div>
  )
}
