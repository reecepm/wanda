import { use } from 'react'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { RiStackLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import type { GitStatusStackBranch } from '../../../../../shared/contracts/git-status'
import { GitManagerContext } from './context'

function byPosition(a: GitStatusStackBranch, b: GitStatusStackBranch) {
  return a.position - b.position || a.name.localeCompare(b.name)
}

function branchMap(branches: ReadonlyArray<GitStatusStackBranch>) {
  return new Map(branches.map((b) => [b.name, b]))
}

function currentBranchName(branches: ReadonlyArray<GitStatusStackBranch>, fallback: string | null) {
  return branches.find((b) => b.isCurrent)?.name ?? fallback
}

function lineageForCurrentStack(
  branches: ReadonlyArray<GitStatusStackBranch>,
  current: string | null,
): GitStatusStackBranch[] {
  if (!current) return [...branches].sort(byPosition).slice(0, 1)

  const branchesByName = branchMap(branches)
  const currentBranch = branchesByName.get(current)
  if (!currentBranch) return [...branches].sort(byPosition).slice(0, 1)

  const names = new Set<string>()
  let cursor: GitStatusStackBranch | undefined = currentBranch
  while (cursor) {
    names.add(cursor.name)
    cursor = cursor.parent ? branchesByName.get(cursor.parent) : undefined
  }

  const addDescendants = (name: string) => {
    const branch = branchesByName.get(name)
    if (!branch) return
    for (const child of branch.children) {
      names.add(child)
      addDescendants(child)
    }
  }
  addDescendants(currentBranch.name)

  return branches.filter((b) => names.has(b.name)).sort(byPosition)
}

function StackBranchList({
  branches,
  totalBranches,
  compact = false,
}: {
  branches: ReadonlyArray<GitStatusStackBranch>
  totalBranches: number
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', compact ? 'max-h-56 overflow-y-auto pr-1' : undefined)}>
      {branches.map((b) => {
        const isTrunk = b.position === 0
        const isCurrent = b.isCurrent
        return (
          <div
            key={b.name}
            className={cn(
              'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]',
              isCurrent ? 'bg-violet-500/10 text-violet-300' : 'text-zinc-400',
            )}
            title={isTrunk ? `${b.name} (trunk)` : `${b.name} · position ${b.position + 1}/${totalBranches}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
            <span className="truncate">{b.name}</span>
            <span className="flex items-center gap-1">
              {isTrunk && <span className="text-[9px] text-zinc-600">trunk</span>}
              {isCurrent && <span className="text-[9px] font-medium text-violet-300">current</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function StackTree() {
  const { podId } = use(GitManagerContext)!

  const { status } = useGitStatus(podId)
  const stack = status?.stack ?? null

  if (!stack || !stack.enabled || !stack.installed || !stack.initialized) return null
  if (stack.branches.length === 0) return null

  const totalBranches = stack.branches.length
  const fullStack = [...stack.branches].sort(byPosition)
  const currentName = currentBranchName(stack.branches, stack.current)
  const visibleStack = lineageForCurrentStack(stack.branches, currentName)
  const hiddenCount = totalBranches - visibleStack.length

  return (
    <div className="group/stack relative px-2 pt-2 pb-1 border-b border-zinc-800">
      <div className="flex items-center gap-1.5 px-1 py-0.5 text-[10px] text-zinc-500">
        <RiStackLine className="size-3" />
        <span className="font-medium">Stack</span>
        <span className="text-zinc-600">
          {visibleStack.length}/{totalBranches}
        </span>
        {hiddenCount > 0 && (
          <span className="ml-auto text-zinc-600" title="Hover to view the full Graphite stack">
            +{hiddenCount}
          </span>
        )}
      </div>
      <div className="mt-0.5 pl-1">
        <StackBranchList branches={visibleStack} totalBranches={totalBranches} />
      </div>
      {hiddenCount > 0 && (
        <div className="absolute left-2 top-8 z-20 hidden w-[310px] rounded-lg border border-zinc-700 bg-zinc-950/95 p-2 shadow-xl group-hover/stack:block">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium text-zinc-500">
            <RiStackLine className="size-3" />
            <span>Full Graphite stack</span>
            <span className="ml-auto text-zinc-600">{totalBranches} branches</span>
          </div>
          <StackBranchList branches={fullStack} totalBranches={totalBranches} compact />
        </div>
      )}
    </div>
  )
}
