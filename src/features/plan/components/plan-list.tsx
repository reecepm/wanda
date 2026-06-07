import { Link } from '@tanstack/react-router'
import { RiAddLine, RiAlertLine } from '@/lib/icons'
import { Button } from '@/ui/button'
import type { Plan, PlanKind } from '../../../../shared/contracts/domain-types'
import { PlanStatusBadge } from './plan-status-control'

const KIND_LABEL: Record<PlanKind, string> = {
  prd: 'PRD',
  'task-plan': 'Task plan',
  proposal: 'Proposal',
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/**
 * Stale check that mirrors the server's `deriveStaleness` for active plans
 * only — non-canonical statuses are filtered out at the query level.
 * Returning a number lets us sort: 1 = stale, 0 = fresh.
 */
function staleScore(plan: Plan): number {
  if (plan.status !== 'active') return 0
  if (plan.lastHumanReviewAt == null) return 1
  if (plan.staleAfterDays != null) {
    const ageDays = (Date.now() - plan.lastHumanReviewAt) / 86_400_000
    if (ageDays > plan.staleAfterDays) return 1
  }
  return 0
}

export function PlanList({
  plans,
  workspaceNames,
  onCreate,
}: {
  plans: Plan[]
  workspaceNames: Map<string, string>
  onCreate: () => void
}) {
  if (plans.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-zinc-500">
        <p className="text-sm">No plans yet.</p>
        <p className="max-w-md text-center text-xs text-zinc-600">
          Plans are durable workspace docs — PRDs, proposals, and task plans — that agents read and edit alongside you.
          Create one to get started.
        </p>
        <Button variant="outline" size="sm" onClick={onCreate}>
          <RiAddLine className="h-4 w-4" />
          Create plan
        </Button>
      </div>
    )
  }

  // Pin stale plans to the top — they need attention. Within each tier the
  // server-provided ordering (updatedAt desc) is preserved.
  const sorted = [...plans].sort((a, b) => staleScore(b) - staleScore(a))

  return (
    <ul className="flex flex-col gap-1.5">
      {sorted.map((plan) => {
        const wsName = workspaceNames.get(plan.workspaceId) ?? '—'
        const stale = staleScore(plan) > 0
        return (
          <li key={plan.id}>
            <Link
              to="/plans/$planId"
              params={{ planId: plan.id }}
              className="flex items-center gap-3 rounded-md border border-zinc-800/50 bg-zinc-900/40 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <div className="flex flex-1 flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-200">{plan.title}</span>
                  <PlanStatusBadge status={plan.status} />
                  {stale && (
                    <span
                      title="No human review yet"
                      className="inline-flex items-center gap-0.5 text-[10px] text-amber-400"
                    >
                      <RiAlertLine className="h-3 w-3" />
                      stale
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{KIND_LABEL[plan.kind]}</span>
                  <span>·</span>
                  <span className="truncate">{wsName}</span>
                  <span>·</span>
                  <span>updated {formatRelative(plan.updatedAt)}</span>
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
