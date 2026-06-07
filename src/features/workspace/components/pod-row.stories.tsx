import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { HoverPreviewBar } from '@/ui/hover-preview-bar'
import type { GitStatus } from '../../../../shared/contracts'
import { PodHoverCard, PodRow } from './pod-row'
import type { PodSummary } from './workspace-list'

const SCENARIOS: { label: string; pod: PodSummary }[] = [
  {
    label: 'a · idle, no agents',
    pod: {
      id: 'a',
      name: 'Dev Server',
      status: 'running',
      runtimeKind: 'shell',
      isLocal: true,
      workspaceId: 'w1',
    },
  },
  {
    label: 'b · agents working, attention needed',
    pod: {
      id: 'b',
      name: 'Feature Builder',
      status: 'running',
      runtimeKind: 'shell',
      isLocal: true,
      workspaceId: 'w1',
      agents: [
        { id: 'g1', name: 'Claude', agentType: 'claude', status: 'working' },
        {
          id: 'g2',
          name: 'Refactor agent',
          agentType: 'claude',
          status: 'working',
          needsAttention: true,
          attentionReason: 'Wants to run: rm -rf node_modules',
        },
        { id: 'g3', name: 'Test runner', agentType: 'codex', status: 'idle' },
      ],
    },
  },
  {
    label: 'c · git changes',
    pod: {
      id: 'c',
      name: 'API Refactor with a really long name that overflows',
      status: 'running',
      runtimeKind: 'shell',
      isLocal: true,
      workspaceId: 'w1',
      agents: [{ id: 'g4', name: 'Claude', agentType: 'claude', status: 'working' }],
    },
  },
  {
    label: 'd · PR open · checks passing',
    pod: {
      id: 'd',
      name: 'Recurring bugs',
      status: 'running',
      runtimeKind: 'shell',
      isLocal: true,
      workspaceId: 'w1',
      agents: [{ id: 'g5', name: 'Claude', agentType: 'claude', status: 'idle' }],
    },
  },
  {
    label: 'e · creating (transition)',
    pod: {
      id: 'e1',
      name: 'New Pod',
      status: 'starting',
      runtimeKind: 'docker',
      isPending: true,
      progressLabel: 'Cloning worktree…',
      workspaceId: 'w1',
    },
  },
  {
    label: 'e · stopping (transition)',
    pod: {
      id: 'e2',
      name: 'Old Service',
      status: 'stopping',
      runtimeKind: 'shell',
      progressLabel: 'Removing pod…',
      workspaceId: 'w1',
    },
  },
  {
    label: 'extra · 50k-line diff (compact format)',
    pod: {
      id: 'big',
      name: 'Massive refactor',
      status: 'running',
      runtimeKind: 'shell',
      isLocal: true,
      workspaceId: 'w1',
      agents: [{ id: 'gbig', name: 'Codex', agentType: 'codex', status: 'working' }],
    },
  },
]

//
// Pre-seeded into the QueryClient so `useGitStatus(podId)` resolves
// instantly with realistic data — without it, RightSignal and the
// hover card would have nothing to show in stories.

const MOCK_GIT_STATUS: Record<string, GitStatus> = {
  a: makeGitStatus('a', { branch: 'main', isDefaultBranch: true }),
  b: makeGitStatus('b', { branch: 'feat/sidebar-v4', upstream: 'origin/feat/sidebar-v4' }),
  c: makeGitStatus('c', {
    branch: 'refactor/api-v2',
    upstream: 'origin/refactor/api-v2',
    diff: { additions: 145, deletions: 32 },
    branchDiff: { additions: 145, deletions: 32 },
  }),
  d: makeGitStatus('d', {
    branch: 'fix/recurring-bugs',
    upstream: 'origin/fix/recurring-bugs',
    diff: { additions: 88, deletions: 14 },
    branchDiff: { additions: 88, deletions: 14 },
    pr: {
      number: 39,
      state: 'OPEN',
      isDraft: false,
      mergeable: 'MERGEABLE',
      checks: 'success',
      url: 'https://example/pr/39',
      title: 'Fix recurring bugs in pod lifecycle',
      headRefName: 'fix/recurring-bugs',
      baseRefName: 'main',
    },
  }),
  big: makeGitStatus('big', {
    branch: 'wip/migrate-everything',
    upstream: 'origin/wip/migrate-everything',
    diff: { additions: 52_413, deletions: 18_927 },
    branchDiff: { additions: 52_413, deletions: 18_927 },
  }),
}

function makeGitStatus(
  podId: string,
  opts: {
    branch?: string | null
    upstream?: string | null
    isDefaultBranch?: boolean
    diff?: { additions: number; deletions: number }
    branchDiff?: { additions: number; deletions: number } | null
    pr?: GitStatus['remote'] extends infer R ? (R extends { pr: infer P } ? P : null) : null
  },
): GitStatus {
  const now = Date.now()
  return {
    podId,
    local: {
      isRepo: true,
      branch: opts.branch ?? null,
      upstream: opts.upstream ?? null,
      hasRemote: !!opts.upstream,
      isDefaultBranch: opts.isDefaultBranch ?? false,
      ahead: 0,
      behind: 0,
      dirty: { staged: 0, unstaged: 0, untracked: 0 },
      hasWorkingTreeChanges: !!opts.diff && (opts.diff.additions > 0 || opts.diff.deletions > 0),
      changedFileCount: opts.diff && (opts.diff.additions > 0 || opts.diff.deletions > 0) ? 1 : 0,
      diffStats: opts.diff ?? { additions: 0, deletions: 0 },
      branchDiffStats: opts.branchDiff ?? null,
      branchDiffFileCount: opts.branchDiff ? 1 : null,
      updatedAt: now,
    },
    remote: opts.pr ? { pr: opts.pr, updatedAt: now } : null,
    stack: null,
  }
}

function ScenarioPanel({ pods }: { pods: PodSummary[] }) {
  const [selectedId, setSelectedId] = useState('b')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Custom QueryClient seeded with the mock git statuses. Inner provider
  // overrides the global one in .storybook/preview.tsx.
  const queryClient = useMemo(() => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    })
    for (const [podId, status] of Object.entries(MOCK_GIT_STATUS)) {
      qc.setQueryData(['git', 'status', podId], status)
    }
    return qc
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      {/* Sidebar-shaped panel with no fake workspace header — this story
          only covers pod rows. The live sidebar's workspace header /
          grouping is unchanged and rendered by `SortableWorkspace`. */}
      <div className="w-60 bg-zinc-950 p-1.5">
        <HoverPreviewBar
          items={pods}
          previewClassName="w-64 rounded-lg border border-zinc-800 bg-zinc-900/95 shadow-2xl shadow-black/50 backdrop-blur overflow-hidden"
          renderPreview={(pod) => <PodHoverCard pod={pod} />}
          renderTrigger={(pod, { onClick }) => {
            const isSelected = selectedId === pod.id
            const isExpanded = expanded[pod.id] ?? false
            const hasChildren = (pod.agents?.length ?? 0) > 0 || (pod.chatSessions?.length ?? 0) > 0
            return (
              <PodRow
                pod={pod}
                isSelected={isSelected}
                attentionFromBadge={pod.agents?.some((a) => a.needsAttention) ?? false}
                expanded={isExpanded}
                onToggleExpanded={() => setExpanded((prev) => ({ ...prev, [pod.id]: !prev[pod.id] }))}
                onSelect={() => {
                  onClick()
                  if (isSelected && hasChildren) {
                    setExpanded((prev) => ({ ...prev, [pod.id]: !prev[pod.id] }))
                  } else {
                    setSelectedId(pod.id)
                  }
                }}
                hasChildren={hasChildren}
              />
            )
          }}
        />
      </div>
    </QueryClientProvider>
  )
}

const meta = {
  title: 'WorkspaceExplorer/PodRow',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-zinc-950 p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Scenarios: Story = {
  name: 'Scenarios (a–e + large diff)',
  render: () => {
    const pods = SCENARIOS.map((s) => s.pod)
    return (
      <div className="flex gap-8 items-start">
        <ScenarioPanel pods={pods} />
        <div className="text-[11px] text-zinc-500 max-w-md leading-snug pt-2">
          <p className="text-zinc-300 mb-1.5">Pod row · v2</p>
          <ul className="list-disc list-outside ml-4 space-y-1">
            <li>
              Hover any pod and wait ~500ms — the shared card opens. Move to a neighbouring pod and it switches
              instantly with the card springing to track. Click a pod to suppress the card until you re-enter.
            </li>
            <li>
              Left slot owns every loading indicator the row shows: amber loader for create, zinc loader for stopping,
              snake spinner when an agent is working.
            </li>
            <li>
              Right side is one priority signal (attention &gt; PR &gt; git delta &gt; status). Diffs use a compact
              format so the 50k-line refactor pod doesn't blow out the row.
            </li>
            <li>
              Chevron only appears on hover (or while expanded) — no reserved space at rest. The right slot height is
              locked, so the row never reflows on the swap.
            </li>
            <li>
              Click an agent-bearing row a second time (or use the chevron) to expand. Note: the expand body is rendered
              by <code>SortablePod</code> in the live sidebar, not here — this story shows the row chrome only.
            </li>
          </ul>
        </div>
      </div>
    )
  },
}

// Subset stories so each state can be reviewed in isolation.
export const Idle: Story = {
  name: 'Idle (no agents)',
  render: () => <ScenarioPanel pods={[SCENARIOS[0]!.pod]} />,
}

export const AgentsWithAttention: Story = {
  name: 'Agents working · attention needed',
  render: () => <ScenarioPanel pods={[SCENARIOS[1]!.pod]} />,
}

export const GitChanges: Story = {
  name: 'Git changes',
  render: () => <ScenarioPanel pods={[SCENARIOS[2]!.pod]} />,
}

export const PullRequest: Story = {
  name: 'PR open · checks passing',
  render: () => <ScenarioPanel pods={[SCENARIOS[3]!.pod]} />,
}

export const Creating: Story = {
  name: 'Creating (transition)',
  render: () => <ScenarioPanel pods={[SCENARIOS[4]!.pod]} />,
}

export const Stopping: Story = {
  name: 'Stopping (transition)',
  render: () => <ScenarioPanel pods={[SCENARIOS[5]!.pod]} />,
}

export const LargeDiff: Story = {
  name: '50k-line diff (compact format)',
  render: () => <ScenarioPanel pods={[SCENARIOS[6]!.pod]} />,
}
