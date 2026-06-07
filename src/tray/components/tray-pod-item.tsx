import { LineDelta } from '@/features/git'
import { POD_STATUS_DOT } from '@/features/workspace'
import { RiGitBranchLine } from '@/lib/icons'
import { formatRelativeTime } from '@/shared/format'
import { cn } from '@/shared/utils'
import { useTrayActions } from '../hooks/use-tray-actions'
import type { TrayPod } from '../hooks/use-tray-data'
import { TrayAgentStack } from './tray-agent-stack'

interface TrayPodItemProps {
  pod: TrayPod
}

export function TrayPodItem({ pod }: TrayPodItemProps) {
  const { navigateMainWindow } = useTrayActions()

  const git = pod.gitSummary
  const hasRunningAgents = pod.agents.some((a) => a.status?.status === 'working')

  return (
    <button
      type="button"
      onClick={() => navigateMainWindow(`/pods/${pod.id}`)}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        'hover:bg-muted/50',
      )}
    >
      {/* Status dot */}
      <span className={cn('size-[6px] shrink-0 rounded-full', POD_STATUS_DOT[pod.status] ?? 'bg-zinc-600')} />

      {/* Pod info */}
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] leading-tight">{pod.name}</span>
          {hasRunningAgents && (
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]" />
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="truncate">{pod.workspaceName}</span>
          {pod.updatedAt && (
            <>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatRelativeTime(pod.updatedAt)}</span>
            </>
          )}
        </div>
        {/* Git diff summary with colored +/- */}
        {git && (git.filesChanged > 0 || git.filesUntracked > 0) && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <RiGitBranchLine className="size-2.5 shrink-0" />
            {git.branch && <span className="max-w-[80px] truncate">{git.branch}</span>}
            {git.filesChanged > 0 && <span className="shrink-0">{git.filesChanged}c</span>}
            {git.filesUntracked > 0 && <span className="shrink-0">{git.filesUntracked}u</span>}
            <LineDelta additions={git.additions} deletions={git.deletions} className="text-[10px]" />
          </div>
        )}
      </div>

      {/* Agent stack */}
      {pod.agents.length > 0 && (
        <TrayAgentStack
          agents={pod.agents}
          onAgentClick={() => {
            navigateMainWindow(`/pods/${pod.id}`)
          }}
        />
      )}
    </button>
  )
}
