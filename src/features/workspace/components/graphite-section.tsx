import { useQuery } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'
import { Checkbox } from '@/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

export type GraphiteCommitDefault = 'modify' | 'newCommit' | 'create'
export type GraphitePushDefault = 'submitStack' | 'submitCurrent' | 'gitPush'
export type GraphitePullDefault = 'sync' | 'gitPull'
export type GraphiteBranchDefault = 'create' | 'gitCheckoutB'

interface GraphiteSectionProps {
  enabled: boolean
  onEnabledChange: (value: boolean) => void
  commitDefault: GraphiteCommitDefault
  onCommitDefaultChange: (value: GraphiteCommitDefault) => void
  pushDefault: GraphitePushDefault
  onPushDefaultChange: (value: GraphitePushDefault) => void
  pullDefault: GraphitePullDefault
  onPullDefaultChange: (value: GraphitePullDefault) => void
  branchDefault: GraphiteBranchDefault
  onBranchDefaultChange: (value: GraphiteBranchDefault) => void
  /** Workspace cwd / repo path used to probe `gt repo info` and trunk. */
  repoPath: string | null
}

interface StatusRow {
  label: string
  state: 'ok' | 'warn' | 'error' | 'pending'
  detail: string
  hint?: string
}

function StatusDot({ state }: { state: StatusRow['state'] }) {
  const colors: Record<StatusRow['state'], string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    error: 'bg-red-500',
    pending: 'bg-zinc-600',
  }
  return <span className={`size-2 rounded-full ${colors[state]}`} />
}

export function GraphiteSection({
  enabled,
  onEnabledChange,
  commitDefault,
  onCommitDefaultChange,
  pushDefault,
  onPushDefaultChange,
  pullDefault,
  onPullDefaultChange,
  branchDefault,
  onBranchDefaultChange,
  repoPath,
}: GraphiteSectionProps) {
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

  const installRow: StatusRow = installLoading
    ? { label: 'Graphite CLI', state: 'pending', detail: 'Checking…' }
    : install?.installed
      ? { label: 'Graphite CLI', state: 'ok', detail: install.version ?? 'installed' }
      : {
          label: 'Graphite CLI',
          state: 'error',
          detail: 'Not installed',
          hint: 'brew install withgraphite/tap/graphite — or: npm i -g @withgraphite/graphite-cli',
        }

  const repoRow: StatusRow | null = !install?.installed
    ? null
    : !repoPath
      ? { label: 'Repository', state: 'pending', detail: 'No working directory set' }
      : repoLoading
        ? { label: 'Repository', state: 'pending', detail: 'Checking…' }
        : repo?.initialized
          ? { label: 'Repository', state: 'ok', detail: repo.trunk ? `Trunk: ${repo.trunk}` : 'Initialized' }
          : { label: 'Repository', state: 'warn', detail: 'Not initialized', hint: 'Run `gt repo init` in this repo.' }

  const authRow: StatusRow | null = !install?.installed
    ? null
    : repoLoading
      ? { label: 'Authentication', state: 'pending', detail: 'Checking…' }
      : repo?.authenticated
        ? { label: 'Authentication', state: 'ok', detail: 'Token configured' }
        : {
            label: 'Authentication',
            state: 'warn',
            detail: 'Not signed in',
            hint: 'Run `gt auth` in any pod terminal.',
          }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={enabled} onCheckedChange={(v) => onEnabledChange(!!v)} />
        <span className="text-xs text-zinc-300">Use Graphite (gt) for stacked PRs</span>
      </label>

      {enabled && (
        <div className="flex flex-col gap-3 pl-5 border-l-2 border-zinc-800">
          {/* Status */}
          <div className="flex flex-col gap-1.5">
            {[installRow, repoRow, authRow]
              .filter((r): r is StatusRow => r !== null)
              .map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <StatusDot state={row.state} />
                    <span className="text-xs text-zinc-300">{row.label}</span>
                    <span className="text-[10px] text-zinc-500">— {row.detail}</span>
                  </div>
                  {row.hint && (
                    <p className="text-[10px] text-zinc-600 pl-4">
                      {row.hint.split(/(`[^`]+`)/).map((chunk) =>
                        chunk.startsWith('`') ? (
                          <code key={`${row.label}:${chunk}`} className="text-zinc-400 bg-zinc-900/60 px-1 rounded">
                            {chunk.slice(1, -1)}
                          </code>
                        ) : (
                          <span key={`${row.label}:${chunk}`}>{chunk}</span>
                        ),
                      )}
                    </p>
                  )}
                </div>
              ))}
          </div>

          {/* Defaults */}
          <div className="flex flex-col gap-1 pt-1">
            <label className="text-xs text-zinc-400">Default commit action</label>
            <ToggleGroup
              value={[commitDefault]}
              onValueChange={(value) => {
                if (value.length) onCommitDefaultChange(value[0] as GraphiteCommitDefault)
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="modify">Modify</ToggleGroupItem>
              <ToggleGroupItem value="newCommit">New commit</ToggleGroupItem>
              <ToggleGroupItem value="create">Stack new</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[10px] text-zinc-600">
              Primary button. The other options stay one click away in the dropdown.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Default push action</label>
            <ToggleGroup
              value={[pushDefault]}
              onValueChange={(value) => {
                if (value.length) onPushDefaultChange(value[0] as GraphitePushDefault)
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="submitStack">Submit stack</ToggleGroupItem>
              <ToggleGroupItem value="submitCurrent">Submit current</ToggleGroupItem>
              <ToggleGroupItem value="gitPush">git push</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Default pull action</label>
            <ToggleGroup
              value={[pullDefault]}
              onValueChange={(value) => {
                if (value.length) onPullDefaultChange(value[0] as GraphitePullDefault)
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="sync">gt sync</ToggleGroupItem>
              <ToggleGroupItem value="gitPull">git pull</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">Default new branch action</label>
            <ToggleGroup
              value={[branchDefault]}
              onValueChange={(value) => {
                if (value.length) onBranchDefaultChange(value[0] as GraphiteBranchDefault)
              }}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="create">gt create</ToggleGroupItem>
              <ToggleGroupItem value="gitCheckoutB">git checkout -b</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      )}
    </div>
  )
}
