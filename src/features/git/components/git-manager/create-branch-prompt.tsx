import { eq } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { use, useState } from 'react'
import { toast } from 'sonner'
import { RiArrowDownSLine, RiGitBranchLine, RiGitPullRequestLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'
import { toBranchName } from './branch-name'
import { type GitContext, GitManagerContext } from './context'

type BranchMode = 'branch' | 'branch-and-pr'

export function CreateBranchPrompt({ podId, currentBranch }: { podId: string; currentBranch: string | null }) {
  const [showInput, setShowInput] = useState(false)
  const [mode, setMode] = useState<BranchMode>('branch')
  const [busy, setBusy] = useState(false)
  const queryClient = useQueryClient()
  const { collection } = use(GitManagerContext)!

  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const repoPath = (pod?.gitContext as GitContext | null)?.repoPath ?? pod?.cwd ?? null

  // Check if there are staged files (needed for branch+PR: must commit first)
  const { data: stagedFiles = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => eq(f.staged, true)),
    [collection],
  )
  const hasStagedChanges = stagedFiles.length > 0

  // User types a display name with spaces — we derive the branch name from it
  const form = useForm({
    defaultValues: { displayName: '' },
    onSubmit: async ({ value }) => {
      const display = value.displayName.trim()
      if (!display) return

      const branchName = toBranchName(display)
      if (!branchName) return

      setBusy(true)
      try {
        // For branch+PR mode, commit staged changes first
        if (mode === 'branch-and-pr' && hasStagedChanges) {
          await orpcUtils.git.commit.call({ podId, message: display })
        }

        const branchResult = await orpcUtils.git.createBranch.call({ podId, branchName })
        if (!branchResult.success) {
          toast.error(branchResult.error ?? 'Failed to create branch')
          return
        }

        // Push sets the upstream tracking branch.
        const pushResult = await orpcUtils.git.push.call({ podId })
        if (!pushResult.success) {
          toast.error(`Branch created but push failed: ${pushResult.error}`)
          queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
          queryClient.invalidateQueries({ queryKey: orpcUtils.git.listBranches.key({ input: { podId } }) })
          setShowInput(false)
          form.reset()
          return
        }

        if (mode === 'branch-and-pr' && repoPath) {
          // 3. Create PR with the display name as title
          try {
            const pr = await orpcUtils.app.createPR.call({ repoPath, title: display, body: '' })
            toast.success(`Branch created, PR #${pr.number} opened`)
          } catch (err) {
            toast.error(`Branch pushed but PR creation failed: ${err instanceof Error ? err.message : 'unknown'}`)
          }
        } else {
          toast.success(`Switched to branch ${branchName}`)
        }

        queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
        queryClient.invalidateQueries({ queryKey: orpcUtils.git.listBranches.key({ input: { podId } }) })
        if (repoPath)
          queryClient.invalidateQueries({ queryKey: orpcUtils.app.getPRStatus.key({ input: { repoPath } }) })
        collection.utils.refetch()
        setShowInput(false)
        form.reset()
      } catch (err) {
        toast.error(`Failed: ${err instanceof Error ? err.message : 'unknown'}`)
      } finally {
        setBusy(false)
      }
    },
  })

  if (!showInput) {
    return (
      <CreateBranchTrigger
        onOpen={(nextMode) => {
          setMode(nextMode)
          setShowInput(true)
        }}
      />
    )
  }

  // Derive branch name preview from display name
  const branchPreview = toBranchName(form.getFieldValue('displayName'))
  const canSubmitBranchAndPR = mode !== 'branch-and-pr' || hasStagedChanges

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="text-[10px] text-zinc-500">
        New branch from <span className="text-zinc-300 font-mono">{currentBranch}</span>
        {mode === 'branch-and-pr' && <span className="text-purple-400 ml-1">+ commit & PR</span>}
      </div>
      <form.Field name="displayName">
        {(field) => (
          <input
            type="text"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder={mode === 'branch-and-pr' ? 'Add dark mode support' : 'feature/my-change'}
            className="w-full h-7 bg-zinc-800 border border-zinc-700 rounded-md px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
        )}
      </form.Field>
      {branchPreview && <div className="text-[10px] text-zinc-600 font-mono truncate">branch: {branchPreview}</div>}
      {mode === 'branch-and-pr' && !hasStagedChanges && (
        <div className="text-[10px] text-amber-400">Stage changes first to create a PR</div>
      )}
      <div className="flex gap-1.5">
        <Button type="button" variant="ghost" size="xs" className="flex-1" onClick={() => setShowInput(false)}>
          Cancel
        </Button>
        <Button type="submit" variant="outline" size="xs" className="flex-1" disabled={busy || !canSubmitBranchAndPR}>
          {busy && <RiLoader4Line className="animate-spin" />}
          {mode === 'branch-and-pr' ? 'Create & open PR' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

function CreateBranchTrigger({ onOpen }: { onOpen: (mode: BranchMode) => void }) {
  return (
    <div className="flex">
      <Button variant="outline" size="xs" className="flex-1 rounded-r-none" onClick={() => onOpen('branch')}>
        <RiGitBranchLine />
        Create branch
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center justify-center size-6 rounded-sm rounded-l-none border border-l-0 border-border text-muted-foreground hover:bg-input/50 transition-colors">
          <RiArrowDownSLine className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          <DropdownMenuItem onClick={() => onOpen('branch')} className="flex flex-col items-start gap-0.5 py-2">
            <div className="flex items-center gap-1.5">
              <RiGitBranchLine className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium">Create branch</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">Create and push a new branch</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpen('branch-and-pr')} className="flex flex-col items-start gap-0.5 py-2">
            <div className="flex items-center gap-1.5">
              <RiGitPullRequestLine className="h-3.5 w-3.5 shrink-0" />
              <span className="text-xs font-medium">Create branch & PR</span>
            </div>
            <span className="text-[10px] text-muted-foreground ml-5">
              Commit staged changes, create branch, push, and open PR
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
