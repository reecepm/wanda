import { useQuery } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'

interface GraphiteStatusBadgeProps {
  workspaceId: string
}

type State = 'ok' | 'install' | 'init' | 'auth' | 'pending'

const STATE_DISPLAY: Record<State, { dot: string; label: string; tooltip: string }> = {
  ok: { dot: 'bg-emerald-500', label: 'Graphite', tooltip: 'Graphite is ready' },
  install: { dot: 'bg-red-500', label: 'Install', tooltip: 'gt is not installed on this machine' },
  init: { dot: 'bg-amber-500', label: 'Init', tooltip: 'Run `gt repo init` in this repo' },
  auth: { dot: 'bg-amber-500', label: 'Sign in', tooltip: 'Run `gt auth` in any pod terminal' },
  pending: { dot: 'bg-zinc-600', label: 'Graphite', tooltip: 'Checking…' },
}

export function GraphiteStatusBadge({ workspaceId }: GraphiteStatusBadgeProps) {
  const { data: workspace } = useQuery(orpcUtils.workspace.getById.queryOptions({ input: { id: workspaceId } }))
  const { data: settings } = useQuery(
    orpcUtils.workspaceSettings.getByWorkspace.queryOptions({ input: { workspaceId } }),
  )

  const enabled = settings?.graphiteEnabled ?? false
  const repoPath = workspace?.repoPath ?? workspace?.cwd ?? null

  const { data: install, isLoading: installLoading } = useQuery({
    ...orpcUtils.graphite.checkInstall.queryOptions({}),
    enabled,
    staleTime: 60_000,
  })

  const { data: repo, isLoading: repoLoading } = useQuery({
    ...orpcUtils.graphite.checkRepo.queryOptions({ input: { repoPath: repoPath ?? '' } }),
    enabled: enabled && !!repoPath && !!install?.installed,
    staleTime: 30_000,
  })

  if (!enabled) return null

  let state: State = 'pending'
  if (installLoading) state = 'pending'
  else if (!install?.installed) state = 'install'
  else if (repoLoading) state = 'pending'
  else if (!repo?.initialized) state = 'init'
  else if (!repo?.authenticated) state = 'auth'
  else state = 'ok'

  const display = STATE_DISPLAY[state]

  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-800/60 cursor-default"
      title={display.tooltip}
    >
      <span className={`size-1.5 rounded-full ${display.dot}`} />
      <span className="text-[10px] font-medium text-zinc-400">{display.label}</span>
    </div>
  )
}
