import { openExternalUrl } from '@/features/terminal'
import { RiExternalLinkLine, RiFolderLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Button } from '@/ui/button'
import { buildEditorUrl } from '../editor-url'
import { type MachineInventory, type PodLite, podStatusColor, type WorkspaceLite } from '../machines-inventory'

function PodPill({ pod }: { pod: PodLite }) {
  const color = podStatusColor[pod.status] ?? 'bg-zinc-600'
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300 bg-zinc-800/60 border border-zinc-800 rounded px-2 py-0.5">
      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', color)} title={pod.status} />
      <span className="truncate max-w-[160px]">{pod.name}</span>
    </span>
  )
}

function WorkspaceRow({
  workspace,
  pods,
  editorUrl,
  canOpenExternal,
}: {
  workspace: WorkspaceLite
  pods: PodLite[]
  editorUrl: string | null
  canOpenExternal: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5 p-2.5 rounded-md border border-zinc-800/80 bg-zinc-900/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <RiFolderLine className="size-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-200 truncate">{workspace.name}</span>
          {workspace.cwd && <span className="text-[10px] text-zinc-500 font-mono truncate">{workspace.cwd}</span>}
        </div>
        {editorUrl && canOpenExternal && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => openExternalUrl(editorUrl)}
            className="shrink-0 text-[10px] text-zinc-400 hover:text-zinc-100"
            title={editorUrl}
          >
            Open in editor
            <RiExternalLinkLine className="size-3 opacity-60" />
          </Button>
        )}
      </div>
      {pods.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pods.map((p) => (
            <PodPill key={p.id} pod={p} />
          ))}
        </div>
      )}
    </div>
  )
}

export function InventorySummary({
  inventory,
  isLoading,
  isError,
  error,
  sshFor,
  canOpenExternal,
}: {
  inventory: MachineInventory | undefined
  isLoading: boolean
  isError: boolean
  error?: unknown
  sshFor: () => { host: string; user?: string; port?: number } | null
  canOpenExternal: boolean
}) {
  if (isLoading) {
    return <p className="text-[11px] text-zinc-500">Loading…</p>
  }
  if (isError || !inventory) {
    const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null
    const looksAuth = msg ? /401|unauthori[sz]ed|invalid[- ]session|forbidden/i.test(msg) : false
    return (
      <div className="flex flex-col gap-1 text-[11px]">
        <p className="text-amber-400/80">
          {looksAuth
            ? 'Session rejected by the remote server — the pairing likely expired or was revoked. Unpair and pair again.'
            : 'Couldn’t reach server.'}
        </p>
        {msg && <p className="text-[10px] text-zinc-600 font-mono break-all">{msg}</p>}
      </div>
    )
  }
  const { workspaces, pods } = inventory
  if (workspaces.length === 0 && pods.length === 0) {
    return <p className="text-[11px] text-zinc-500">No workspaces or pods yet.</p>
  }
  const podsByWorkspace = new Map<string | null, PodLite[]>()
  for (const p of pods) {
    const key = p.workspaceId ?? null
    const list = podsByWorkspace.get(key) ?? []
    list.push(p)
    podsByWorkspace.set(key, list)
  }
  const orphaned = podsByWorkspace.get(null) ?? []
  const ssh = sshFor()
  const externalAvailable = canOpenExternal

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      {workspaces.map((ws) => (
        <WorkspaceRow
          key={ws.id}
          workspace={ws}
          pods={podsByWorkspace.get(ws.id) ?? []}
          editorUrl={buildEditorUrl(ws.cwd ?? '', ssh)}
          canOpenExternal={externalAvailable}
        />
      ))}
      {orphaned.length > 0 && (
        <div className="flex flex-col gap-1.5 p-2.5 rounded-md border border-dashed border-zinc-800/80">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Unassigned pods</div>
          <div className="flex flex-wrap gap-1">
            {orphaned.map((p) => (
              <PodPill key={p.id} pod={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
