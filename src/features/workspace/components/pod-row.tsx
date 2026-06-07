// Pod row — the v2 design wired to live data (`useGitStatus`). Used by
// the sidebar's `WorkspaceList` for every pod.
//
// Behaviour:
// - Single line at rest. Two lines only during pod creation while a
//   progress label is showing.
// - Left slot owns the only loading indicator the row ever shows:
//   create/start spinner, working-agent braille spinner, otherwise empty.
// - Right slot picks ONE priority signal: attention > PR > git delta >
//   status. Diffs are compacted ("+12k / −3.4k").
// - Chevron only appears on hover or when expanded. Right slot height is
//   locked so the row never reflows when signal ↔ chevron swap.
//
// The hover card is owned by `HoverPreviewBar` (src/ui/hover-preview-bar.tsx)
// — `PodHoverCard` is exported here so callers can pass it as the
// `renderPreview` argument.

import { type ReactNode, useEffect, useState } from 'react'
import spinners, { type BrailleSpinnerName } from 'unicode-animations'
import { useGitStatus } from '@/features/git'
import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { RiArrowDownSLine, RiGitPullRequestLine, RiLoader4Line } from '@/lib/icons'
import { cn } from '@/shared/utils'
import type { GitStatus, GitStatusPR } from '../../../../shared/contracts'
import type { AgentSummary, ChatSessionSummary, PodSummary } from './workspace-list'

const POD_SPINNER_NAME: BrailleSpinnerName = 'snake'

function PodAgentSpinner({ className }: { className?: string }) {
  const spinner = spinners[POD_SPINNER_NAME]
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => (f + 1) % spinner.frames.length)
    }, spinner.interval)
    return () => clearInterval(id)
  }, [spinner])
  return (
    <span
      className={cn(
        'font-mono leading-none whitespace-pre inline-flex items-center justify-center size-3.5',
        className,
      )}
      aria-hidden
    >
      {spinner.frames[frame]}
    </span>
  )
}

function formatLines(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

function CompactDelta({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono tabular-nums shrink-0 text-[10px]">
      <span className="text-emerald-400">+{formatLines(additions)}</span>
      <span className="text-zinc-700 mx-0.5">/</span>
      <span className="text-red-400">−{formatLines(deletions)}</span>
    </span>
  )
}

function FullDelta({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="font-mono tabular-nums text-[11px]">
      <span className="text-emerald-400">+{additions}</span>
      <span className="text-zinc-700 mx-0.5">/</span>
      <span className="text-red-400">−{deletions}</span>
    </span>
  )
}

function prAccent(pr: GitStatusPR): string {
  if (pr.state === 'MERGED') return 'text-purple-400'
  if (pr.state === 'CLOSED') return 'text-zinc-500'
  if (pr.isDraft) return 'text-zinc-400'
  if (pr.checks === 'success') return 'text-emerald-400'
  if (pr.checks === 'failure') return 'text-red-400'
  return 'text-amber-400'
}

function AgentTypeIcon({ type, className }: { type: AgentSummary['agentType']; className?: string }) {
  if (type === 'claude') return <ClaudeIcon className={cn('text-zinc-300', className)} />
  if (type === 'codex') return <OpenAIIcon className={cn('text-zinc-300', className)} />
  return <OpenCodeIcon className={cn('text-zinc-300', className)} />
}

function agentSummary(agents: AgentSummary[]): string {
  const working = agents.filter((a) => a.status === 'working').length
  const idle = agents.filter((a) => a.status === 'idle').length
  const attention = agents.filter((a) => a.needsAttention).length
  const parts: string[] = []
  if (working) parts.push(`${working} loading`)
  if (idle) parts.push(`${idle} idle`)
  if (attention) parts.push(`${attention} waiting`)
  return parts.length ? parts.join(' · ') : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`
}

// Strip `origin/` (or other remote) prefix from an upstream label so the
// hover card's `branch ← base` reads as plain branch names.
function stripRemote(upstream: string | null): string | null {
  if (!upstream) return null
  const slash = upstream.indexOf('/')
  return slash > 0 ? upstream.slice(slash + 1) : upstream
}

type SignalKind = 'attention' | 'pr' | 'git' | 'failed' | 'running' | 'stopped' | 'none'

function pickSignal(pod: PodSummary, git: GitStatus | null, attentionFromBadge: boolean): SignalKind {
  if (pod.isPending) return 'none' // left-slot owns it
  if (pod.status === 'starting' || pod.status === 'stopping') return 'none'
  if (
    attentionFromBadge ||
    pod.agents?.some((a) => a.needsAttention) ||
    pod.chatSessions?.some((s) => s.needsAttention)
  )
    return 'attention'
  if (pod.status === 'failed') return 'failed'
  const pr = git?.remote?.pr ?? null
  if (pr) return 'pr'
  const stats = git?.local.branchDiffStats ?? git?.local.diffStats ?? null
  if (stats && (stats.additions > 0 || stats.deletions > 0)) return 'git'
  if (pod.status === 'stopped') return 'stopped'
  if (pod.status === 'running' && !pod.isLocal) return 'running'
  return 'none'
}

function RightSignal({
  pod,
  git,
  attentionFromBadge,
}: {
  pod: PodSummary
  git: GitStatus | null
  attentionFromBadge: boolean
}) {
  const sig = pickSignal(pod, git, attentionFromBadge)
  if (sig === 'attention')
    return <span className="size-2 rounded-full bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.6)] animate-pulse" />
  if (sig === 'pr' && git?.remote?.pr) {
    const pr = git.remote.pr
    return (
      <span
        className={cn('inline-flex items-center gap-0.5 font-mono tabular-nums text-[10px]', prAccent(pr))}
        title={`PR #${pr.number}${pr.isDraft ? ' (draft)' : ''}`}
      >
        <RiGitPullRequestLine className="size-3" />
        {pr.number}
      </span>
    )
  }
  if (sig === 'git' && git) {
    const stats = git.local.branchDiffStats ?? git.local.diffStats
    return <CompactDelta additions={stats.additions} deletions={stats.deletions} />
  }
  if (sig === 'failed')
    return <span className="size-[6px] rounded-full bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.4)]" />
  if (sig === 'running')
    return <span className="size-[6px] rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.4)]" />
  if (sig === 'stopped') return <span className="size-[6px] rounded-full bg-zinc-600" />
  return null
}

export function PodHoverCard({ pod }: { pod: PodSummary }) {
  const { status: git } = useGitStatus(pod.id)
  const agents = pod.agents ?? []
  const chats = pod.chatSessions ?? []
  const stats = git?.local.branchDiffStats ?? git?.local.diffStats ?? null
  const hasGit = !!stats && (stats.additions > 0 || stats.deletions > 0)
  const pr = git?.remote?.pr ?? null
  const hasPR = !!pr
  const hasAgents = agents.length > 0 || chats.length > 0
  const hasBody = hasGit || hasPR || hasAgents
  const attentionReason = agents.find((a) => a.attentionReason)?.attentionReason

  const branch = git?.local.branch ?? null
  const baseBranch = pr?.baseRefName ?? stripRemote(git?.local.upstream ?? null)

  // Content only — the card chrome (border, bg, shadow, rounded, width)
  // lives on HoverPreviewBar's outer motion container via `previewClassName`
  // so it stays mounted across pod switches. Only this content crossfades.
  return (
    <div className="text-[11px] text-zinc-300">
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2.5">
        <div className="flex items-baseline justify-between gap-2">
          {/* min-w-0 + break-words lets long names wrap onto extra lines
              instead of pushing the runtime label off-screen to the right. */}
          <div className="font-medium text-zinc-100 text-[12px] flex-1 min-w-0 break-words leading-snug">
            {pod.name}
          </div>
          <div className="text-[10px] text-zinc-500 shrink-0 font-mono">{pod.runtimeKind}</div>
        </div>
        {branch && (
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
            <span className="truncate text-zinc-300">{branch}</span>
            {baseBranch && baseBranch !== branch && (
              <>
                <span className="text-zinc-700">←</span>
                <span className="truncate">{baseBranch}</span>
              </>
            )}
          </div>
        )}
      </div>
      {hasBody && (
        <div className="flex flex-col gap-2 px-3 pb-2.5 pt-2 border-t border-zinc-800/70">
          {hasGit && stats && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Changes</span>
              <FullDelta additions={stats.additions} deletions={stats.deletions} />
            </div>
          )}
          {hasPR && pr && (
            <div className="rounded-md border border-zinc-800/80 bg-black/20 p-2">
              <div className="flex items-center gap-1.5 mb-0.5">
                <RiGitPullRequestLine className={cn('size-3 shrink-0', prAccent(pr))} />
                <span className={cn('text-[11px] font-medium tabular-nums', prAccent(pr))}>#{pr.number}</span>
                {pr.isDraft && <span className="text-[10px] text-zinc-500">draft</span>}
                {pr.mergeable === 'CONFLICTING' && <span className="text-[10px] text-red-400">conflicts</span>}
                <span className="ml-auto text-[10px] text-zinc-500">{pr.checks}</span>
              </div>
              <div className="text-[11px] text-zinc-300 line-clamp-2 leading-tight">{pr.title}</div>
            </div>
          )}
          {hasAgents && (
            <div className="flex flex-col gap-1">
              {agents.length > 0 && (
                <>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide">
                    Agents · {agentSummary(agents)}
                  </div>
                  <ul className="flex flex-col gap-1">
                    {agents.map((agent) => (
                      <li key={agent.id} className="flex items-center gap-1.5 text-[11px]">
                        <AgentTypeIcon type={agent.agentType} className="size-3" />
                        <span className={cn('truncate', agent.needsAttention ? 'text-amber-300' : 'text-zinc-300')}>
                          {agent.name}
                        </span>
                        <span
                          className={cn(
                            'ml-auto h-[5px] w-[5px] rounded-full shrink-0',
                            agent.needsAttention
                              ? 'bg-amber-400 animate-pulse'
                              : agent.status === 'working'
                                ? 'bg-emerald-400'
                                : agent.status === 'error'
                                  ? 'bg-red-400'
                                  : 'bg-zinc-600',
                          )}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {chats.length > 0 && (
                <>
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wide mt-1">Chats · {chats.length}</div>
                  <ul className="flex flex-col gap-1">
                    {chats.map((chat) => (
                      <li key={chat.id} className="flex items-center gap-1.5 text-[11px]">
                        <span
                          className={cn(
                            'truncate flex-1 min-w-0',
                            chat.needsAttention ? 'text-amber-300' : 'text-zinc-300',
                          )}
                        >
                          {chat.name}
                        </span>
                        <span
                          className={cn(
                            'ml-auto h-[5px] w-[5px] rounded-full shrink-0',
                            chat.needsAttention
                              ? 'bg-amber-400 animate-pulse'
                              : chat.state === 'running'
                                ? 'bg-emerald-400'
                                : chat.state === 'error'
                                  ? 'bg-red-400'
                                  : 'bg-zinc-600',
                          )}
                        />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {attentionReason && <div className="text-[10px] text-amber-300/80 leading-snug">{attentionReason}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function PodRow({
  pod,
  isSelected,
  attentionFromBadge,
  expanded,
  onToggleExpanded,
  onSelect,
  hasChildren,
  renameInput,
}: {
  pod: PodSummary
  isSelected: boolean
  attentionFromBadge: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onSelect: () => void
  hasChildren: boolean
  /** Inline rename `<input>`; replaces the name span when present. */
  renameInput?: ReactNode
}) {
  const { status: git } = useGitStatus(pod.id)
  const agents = pod.agents ?? []
  const anyWorking = agents.some((a) => a.status === 'working')
  // Local hover state — drives the chevron only. The hover card has its
  // own delay/state via HoverPreviewBar, kept independent of this.
  const [rowHovered, setRowHovered] = useState(false)

  const isCreate = !!pod.isPending || pod.status === 'starting'
  const isStopping = pod.status === 'stopping'
  const showChevron = (rowHovered || expanded) && hasChildren && !pod.isPending

  const leftIndicator: 'create' | 'stopping' | 'working' | null = isCreate
    ? 'create'
    : isStopping
      ? 'stopping'
      : anyWorking
        ? 'working'
        : null

  return (
    <div onMouseEnter={() => setRowHovered(true)} onMouseLeave={() => setRowHovered(false)}>
      <button
        type="button"
        data-wanda-pod-row=""
        data-wanda-pod-id={pod.id}
        data-wanda-pod-name={pod.name}
        onClick={onSelect}
        className={cn(
          'group w-full text-left rounded-md transition-colors flex flex-col px-2 py-[7px] cursor-default',
          isSelected
            ? 'bg-white/[0.07] text-zinc-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
            : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-400',
          isStopping && 'opacity-60',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* Left slot — owns every loading indicator the row shows. */}
          <div className="w-[18px] shrink-0 flex items-center justify-center">
            {leftIndicator === 'create' && <RiLoader4Line className="size-3.5 text-amber-400 animate-spin" />}
            {leftIndicator === 'stopping' && <RiLoader4Line className="size-3.5 text-zinc-500 animate-spin" />}
            {leftIndicator === 'working' && <PodAgentSpinner className="text-emerald-400 text-[12px]" />}
          </div>
          {renameInput ? (
            <div className="flex-1 min-w-0">{renameInput}</div>
          ) : (
            <span
              className={cn(
                'text-[12px] truncate leading-tight flex-1 min-w-0 transition-colors',
                isSelected ? 'text-zinc-100' : 'text-zinc-500 group-hover:text-zinc-400',
              )}
            >
              {pod.name}
            </span>
          )}
          {/* Right slot — locked height so signal ↔ chevron swap doesn't reflow. */}
          <div className="shrink-0 flex items-center gap-1.5 h-4">
            {showChevron ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpanded()
                }}
                className="-mr-1 size-4 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200"
                aria-label={expanded ? 'Collapse items' : 'Expand items'}
              >
                <RiArrowDownSLine className={cn('size-3.5 transition-transform', !expanded && '-rotate-90')} />
              </button>
            ) : (
              <RightSignal pod={pod} git={git} attentionFromBadge={attentionFromBadge} />
            )}
          </div>
        </div>
        {pod.progressLabel && (
          <div className="text-[10px] text-amber-300/80 truncate leading-tight mt-0.5 ml-[26px]">
            {pod.progressLabel}
          </div>
        )}
      </button>
    </div>
  )
}

export type { AgentSummary, ChatSessionSummary, PodSummary }
