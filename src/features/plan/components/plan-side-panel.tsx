import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RiCloseLine, RiHistoryLine, RiLink, RiUserLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/tabs'
import type { PlanLink, PlanLinkKind, PlanWithMeta } from '../../../../shared/contracts/domain-types'
import { PlanComments } from './plan-comments'

const LINK_KIND_LABEL: Record<PlanLinkKind, string> = {
  workenv: 'Workenv',
  pod: 'Pod',
  chatSession: 'Chat',
  branch: 'Branch',
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function PlanSidePanel({ plan }: { plan: PlanWithMeta }) {
  return (
    <Tabs defaultValue="comments" className="flex h-full min-h-0 flex-col">
      <TabsList variant="line" className="px-3 pt-2">
        <TabsTrigger value="comments">Comments</TabsTrigger>
        <TabsTrigger value="links">Links</TabsTrigger>
        <TabsTrigger value="revisions">Revisions</TabsTrigger>
      </TabsList>
      <TabsContent value="comments" className="flex-1 min-h-0 overflow-hidden">
        <PlanComments plan={plan} />
      </TabsContent>
      <TabsContent value="links" className="flex-1 overflow-y-auto">
        <LinksList planId={plan.id} links={plan.links} />
      </TabsContent>
      <TabsContent value="revisions" className="flex-1 overflow-y-auto">
        <RevisionsList planId={plan.id} />
      </TabsContent>
    </Tabs>
  )
}

function LinksList({ planId, links }: { planId: string; links: PlanLink[] }) {
  const queryClient = useQueryClient()

  async function handleRemove(linkId: string) {
    await orpcUtils.plan.removeLink.call({ linkId })
    queryClient.invalidateQueries({ queryKey: orpcUtils.plan.get.key({ input: { id: planId } }) })
  }

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-zinc-500">
        <RiLink className="h-5 w-5 text-zinc-700" />
        <p>No links yet.</p>
        <p className="max-w-[200px] text-zinc-600">
          Linked pods, workenvs, and branches help agents discover this plan and let it auto-complete on merge.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-1 px-3 py-3">
      {links.map((link) => (
        <li
          key={link.id}
          className="group flex items-center gap-2 rounded-md border border-zinc-800/50 bg-zinc-900/30 px-2 py-1.5"
        >
          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400">
            {LINK_KIND_LABEL[link.kind]}
          </span>
          <span className="flex-1 truncate text-xs text-zinc-300">{link.label ?? link.refId}</span>
          <button
            type="button"
            onClick={() => handleRemove(link.id)}
            className="text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 group-hover:opacity-100"
            aria-label="Remove link"
          >
            <RiCloseLine className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function RevisionsList({ planId }: { planId: string }) {
  const { data: revisions = [], isLoading } = useQuery(
    orpcUtils.plan.listRevisions.queryOptions({ input: { planId, limit: 50 } }),
  )

  if (isLoading) {
    return <p className="px-4 py-6 text-center text-xs text-zinc-600">Loading…</p>
  }
  if (revisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-xs text-zinc-500">
        <RiHistoryLine className="h-5 w-5 text-zinc-700" />
        <p>No revisions yet.</p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-px px-3 py-3">
      {revisions.map((rev) => (
        <li key={rev.id} className="flex flex-col gap-0.5 border-b border-zinc-800/50 px-1 py-2 last:border-b-0">
          <div className="flex items-center gap-2">
            <RiUserLine className={rev.authorKind === 'agent' ? 'h-3 w-3 text-violet-400' : 'h-3 w-3 text-zinc-500'} />
            <span className="truncate text-[11px] text-zinc-300">
              {rev.authorKind === 'agent' ? 'Agent' : 'User'} · {rev.authorId}
            </span>
            <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{formatRelative(rev.createdAt)}</span>
          </div>
          {rev.summary && <p className="ml-5 text-[11px] text-zinc-500">{rev.summary}</p>}
        </li>
      ))}
    </ul>
  )
}

export function PlanLinkAddButton({ planId }: { planId: string }) {
  const queryClient = useQueryClient()
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const refId = window.prompt('Branch / pod / workenv id to link:')
        if (!refId) return
        await orpcUtils.plan.addLink.call({ planId, kind: 'branch', refId })
        queryClient.invalidateQueries({ queryKey: orpcUtils.plan.get.key({ input: { id: planId } }) })
      }}
    >
      Add link
    </Button>
  )
}
