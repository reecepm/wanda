import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { use, useState } from 'react'
import { toast } from 'sonner'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import {
  RiArrowDownLine,
  RiArrowDownSLine,
  RiArrowUpLine,
  RiCheckLine,
  RiGitMergeLine,
  RiLoader4Line,
  RiStackLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'
import { type GitContext, GitManagerContext } from './context'

type CommitDefault = 'modify' | 'newCommit' | 'create'
type PushDefault = 'submitStack' | 'submitCurrent' | 'gitPush'
type PullDefault = 'sync' | 'gitPull'

interface GraphiteActionsProps {
  podId: string
  workspaceId: string
  repoPath: string
  defaults: {
    commit: CommitDefault
    push: PushDefault
    pull: PullDefault
  }
}

const COMMIT_LABEL: Record<CommitDefault, string> = {
  modify: 'Modify branch',
  newCommit: 'New commit',
  create: 'Stack new branch',
}
const COMMIT_DESC: Record<CommitDefault, string> = {
  modify: 'Amend the latest commit on this branch and restack children',
  newCommit: 'New commit on this branch and restack children',
  create: 'Create a new child branch with the staged changes',
}
const PUSH_LABEL: Record<PushDefault, string> = {
  submitStack: 'Submit stack',
  submitCurrent: 'Submit current',
  gitPush: 'git push',
}
const PUSH_DESC: Record<PushDefault, string> = {
  submitStack: 'Push every branch in the stack and update PR bases',
  submitCurrent: 'Push only this branch',
  gitPush: 'Plain git push — bypasses Graphite',
}
const PULL_LABEL: Record<PullDefault, string> = {
  sync: 'Sync stack',
  gitPull: 'git pull',
}
const PULL_DESC: Record<PullDefault, string> = {
  sync: 'Pull trunk, restack the stack, prune merged branches',
  gitPull: 'Plain git pull — bypasses Graphite',
}

export function GraphiteCommitForm({
  podId,
  workspaceId: _workspaceId,
  repoPath,
  defaults,
  stagedCount,
}: GraphiteActionsProps & { stagedCount: number }) {
  const queryClient = useQueryClient()
  const { collection, setSelectedFile } = use(GitManagerContext)!
  const [primary, setPrimary] = useState<CommitDefault | 'gitCommit'>(defaults.commit)

  function refresh() {
    collection.utils.refetch()
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.graphite.getStack.key({ input: { repoPath } }) })
    queryClient.invalidateQueries({
      predicate: (q) => {
        const key = q.queryKey as string[]
        return Array.isArray(key) && key.some((k) => typeof k === 'string' && k.includes('getDiff'))
      },
    })
    setSelectedFile(null)
  }

  const mutation = useMutation({
    mutationFn: async (opts: { mode: CommitDefault | 'gitCommit'; message?: string }) => {
      if (opts.mode === 'gitCommit') {
        if (!opts.message) throw new Error('Commit message is required')
        return orpcUtils.git.commit.call({ podId, message: opts.message })
      }
      if (opts.mode === 'modify') {
        const res = await orpcUtils.graphite.modify.call({ repoPath, message: opts.message })
        if (!res.success) throw new Error(res.error ?? 'gt modify failed')
        return res
      }
      if (opts.mode === 'newCommit') {
        const res = await orpcUtils.graphite.modify.call({ repoPath, asNewCommit: true, message: opts.message })
        if (!res.success) throw new Error(res.error ?? 'gt modify --commit failed')
        return res
      }
      const res = await orpcUtils.graphite.create.call({ repoPath, message: opts.message })
      if (!res.success) throw new Error(res.error ?? 'gt create failed')
      return res
    },
    onSettled: refresh,
  })

  const form = useForm({
    defaultValues: { message: '' },
    onSubmit: async ({ value }) => {
      const message = value.message.trim()
      if (primary !== 'modify' && !message) return
      // `modify` (amend) is the only mode that doesn't strictly need staged
      // changes — gt happily amends an empty commit. Everything else needs
      // a non-zero staged count.
      if (primary !== 'modify' && stagedCount === 0) return
      const submittedMode = primary
      mutation.mutate(
        { mode: submittedMode, message: message || undefined },
        {
          onSuccess: () => {
            form.reset()
            const labels: Record<typeof submittedMode, string> = {
              modify: 'Branch modified',
              newCommit: 'Committed',
              create: 'Stack branch created',
              gitCommit: 'Committed',
            }
            toast.success(labels[submittedMode])
          },
          onError: (err) => toast.error(err.message),
        },
      )
    },
  })

  const choices: { id: typeof primary; label: string; desc: string }[] = [
    { id: 'modify', label: COMMIT_LABEL.modify, desc: COMMIT_DESC.modify },
    { id: 'newCommit', label: COMMIT_LABEL.newCommit, desc: COMMIT_DESC.newCommit },
    { id: 'create', label: COMMIT_LABEL.create, desc: COMMIT_DESC.create },
    { id: 'gitCommit', label: 'git commit', desc: 'Plain git commit — bypasses Graphite' },
  ]
  const primaryLabel = primary === 'gitCommit' ? 'git commit' : COMMIT_LABEL[primary]

  const disabled = mutation.isPending || (primary !== 'modify' && stagedCount === 0)

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-2"
    >
      <form.Field name="message">
        {(field) => (
          <textarea
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder={primary === 'modify' ? 'Amend message (optional, leave blank to keep)' : 'Commit message...'}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                form.handleSubmit()
              }
            }}
          />
        )}
      </form.Field>
      <div className="flex">
        <Button type="submit" variant="outline" size="xs" disabled={disabled} className="flex-1 rounded-r-none">
          {mutation.isPending ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
          {primaryLabel}
          {stagedCount > 0 && primary !== 'modify' ? ` (${stagedCount})` : ''}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center justify-center size-6 rounded-sm rounded-l-none border border-l-0 border-border text-muted-foreground hover:bg-input/50 transition-colors"
            disabled={mutation.isPending}
          >
            <RiArrowDownSLine className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64">
            <DropdownMenuLabel className="text-[10px]">Commit action</DropdownMenuLabel>
            {choices.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onClick={() => setPrimary(c.id)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className={`text-xs ${c.id === primary ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}>
                  {c.label} {c.id === primary && <span className="text-[10px] text-violet-400 ml-1">primary</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">{c.desc}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </form>
  )
}

export function GraphiteSyncButtons({ podId, repoPath, defaults }: GraphiteActionsProps) {
  const queryClient = useQueryClient()
  const { collection } = use(GitManagerContext)!
  const { refresh: refreshGitStatus } = useGitStatus(podId)
  const [pushPrimary, setPushPrimary] = useState<PushDefault>(defaults.push)
  const [pullPrimary, setPullPrimary] = useState<PullDefault>(defaults.pull)

  function refreshAll() {
    void refreshGitStatus()
    queryClient.invalidateQueries({ queryKey: orpcUtils.graphite.getStack.key({ input: { repoPath } }) })
    collection.utils.refetch()
  }

  const pull = useMutation({
    mutationFn: async (mode: PullDefault) => {
      if (mode === 'gitPull') {
        return orpcUtils.git.pull.call({ podId })
      }
      const res = await orpcUtils.graphite.sync.call({ repoPath })
      if (!res.success) throw new Error(res.error ?? 'gt sync failed')
      return res
    },
    onSettled: refreshAll,
  })

  const push = useMutation({
    mutationFn: async (mode: PushDefault) => {
      if (mode === 'gitPush') {
        return orpcUtils.git.push.call({ podId })
      }
      const res = await orpcUtils.graphite.submit.call({ repoPath, stack: mode === 'submitStack' })
      if (!res.success) throw new Error(res.error ?? 'gt submit failed')
      return res
    },
    onSettled: refreshAll,
  })

  return (
    <div className="flex gap-1.5">
      {/* Pull */}
      <div className="flex flex-1">
        <Button
          variant="outline"
          size="xs"
          className="flex-1 rounded-r-none"
          disabled={pull.isPending}
          onClick={() =>
            pull.mutate(pullPrimary, {
              onSuccess: () => toast.success(pullPrimary === 'sync' ? 'Stack synced' : 'Pulled'),
              onError: (err) => toast.error(err.message),
            })
          }
        >
          {pull.isPending ? <RiLoader4Line className="animate-spin" /> : <RiArrowDownLine />}
          {PULL_LABEL[pullPrimary]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center justify-center size-6 rounded-sm rounded-l-none border border-l-0 border-border text-muted-foreground hover:bg-input/50 transition-colors"
            disabled={pull.isPending}
          >
            <RiArrowDownSLine className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-[10px]">Pull action</DropdownMenuLabel>
            {(['sync', 'gitPull'] as PullDefault[]).map((m) => (
              <DropdownMenuItem
                key={m}
                onClick={() => setPullPrimary(m)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className={`text-xs ${m === pullPrimary ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}>
                  {PULL_LABEL[m]}{' '}
                  {m === pullPrimary && <span className="text-[10px] text-violet-400 ml-1">primary</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">{PULL_DESC[m]}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() =>
                push.mutate('gitPush', {
                  onSuccess: () => toast.success('Pushed'),
                  onError: (err) => toast.error(err.message),
                })
              }
            >
              <RiArrowUpLine className="size-3.5" />
              <span className="text-xs">Force-run git push (right now)</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Push */}
      <div className="flex flex-1">
        <Button
          variant="outline"
          size="xs"
          className="flex-1 rounded-r-none"
          disabled={push.isPending}
          onClick={() =>
            push.mutate(pushPrimary, {
              onSuccess: () => toast.success(pushPrimary === 'gitPush' ? 'Pushed' : 'Submitted'),
              onError: (err) => toast.error(err.message),
            })
          }
        >
          {push.isPending ? <RiLoader4Line className="animate-spin" /> : <RiArrowUpLine />}
          {PUSH_LABEL[pushPrimary]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex items-center justify-center size-6 rounded-sm rounded-l-none border border-l-0 border-border text-muted-foreground hover:bg-input/50 transition-colors"
            disabled={push.isPending}
          >
            <RiArrowDownSLine className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
            <DropdownMenuLabel className="text-[10px]">Push action</DropdownMenuLabel>
            {(['submitStack', 'submitCurrent', 'gitPush'] as PushDefault[]).map((m) => (
              <DropdownMenuItem
                key={m}
                onClick={() => setPushPrimary(m)}
                className="flex flex-col items-start gap-0.5 py-2"
              >
                <span className={`text-xs ${m === pushPrimary ? 'text-zinc-100 font-medium' : 'text-zinc-300'}`}>
                  {PUSH_LABEL[m]}{' '}
                  {m === pushPrimary && <span className="text-[10px] text-violet-400 ml-1">primary</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">{PUSH_DESC[m]}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function GraphiteRestackButton({ repoPath, podId }: { repoPath: string; podId: string }) {
  const queryClient = useQueryClient()
  const { refresh } = useGitStatus(podId)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await orpcUtils.graphite.restack.call({ repoPath })
      if (!res.success) throw new Error(res.error ?? 'gt restack failed')
      return res
    },
    onSettled: () => {
      void refresh()
      queryClient.invalidateQueries({ queryKey: orpcUtils.graphite.getStack.key({ input: { repoPath } }) })
    },
  })

  return (
    <Button
      variant="outline"
      size="xs"
      className="w-full"
      disabled={mutation.isPending}
      onClick={() =>
        mutation.mutate(undefined, {
          onSuccess: () => toast.success('Stack restacked'),
          onError: (err) => toast.error(err.message),
        })
      }
    >
      {mutation.isPending ? <RiLoader4Line className="animate-spin" /> : <RiGitMergeLine />}
      Restack
    </Button>
  )
}

export function GraphiteAwareCommitForm({
  podId,
  stagedCount,
  fallback,
}: {
  podId: string
  stagedCount: number
  fallback: React.ReactNode
}) {
  const { status } = useGitStatus(podId)
  const stack = status?.stack ?? null
  const ready = !!(stack?.enabled && stack?.installed && stack?.initialized)

  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const workspaceId = pod?.workspaceId ?? null
  const repoPath = (pod?.gitContext as GitContext | null)?.repoPath ?? pod?.cwd ?? null

  const { data: settings } = useQuery({
    ...orpcUtils.workspaceSettings.getByWorkspace.queryOptions({ input: { workspaceId: workspaceId ?? '' } }),
    enabled: !!workspaceId,
  })

  if (!ready || !workspaceId || !repoPath || !settings) return <>{fallback}</>

  return (
    <GraphiteCommitForm
      podId={podId}
      workspaceId={workspaceId}
      repoPath={repoPath}
      stagedCount={stagedCount}
      defaults={{
        commit: settings.graphiteDefaultCommit,
        push: settings.graphiteDefaultPush,
        pull: settings.graphiteDefaultPull,
      }}
    />
  )
}

export function GraphiteAwareSyncButtons({ podId, fallback }: { podId: string; fallback: React.ReactNode }) {
  const { status } = useGitStatus(podId)
  const stack = status?.stack ?? null
  const ready = !!(stack?.enabled && stack?.installed && stack?.initialized)

  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const workspaceId = pod?.workspaceId ?? null
  const repoPath = (pod?.gitContext as GitContext | null)?.repoPath ?? pod?.cwd ?? null

  const { data: settings } = useQuery({
    ...orpcUtils.workspaceSettings.getByWorkspace.queryOptions({ input: { workspaceId: workspaceId ?? '' } }),
    enabled: !!workspaceId,
  })

  if (!ready || !workspaceId || !repoPath || !settings) return <>{fallback}</>

  return (
    <div className="flex flex-col gap-1.5">
      <GraphiteSyncButtons
        podId={podId}
        workspaceId={workspaceId}
        repoPath={repoPath}
        defaults={{
          commit: settings.graphiteDefaultCommit,
          push: settings.graphiteDefaultPush,
          pull: settings.graphiteDefaultPull,
        }}
      />
      {/* Restack lives below the primary row — it's a stack-hygiene action, not a sync action. */}
      <RestackHintRow podId={podId} repoPath={repoPath} />
    </div>
  )
}

function RestackHintRow({ podId, repoPath }: { podId: string; repoPath: string }) {
  // Don't bother offering Restack on trunk — there's nothing below it.
  const { status } = useGitStatus(podId)
  const branch = status?.local.branch ?? null
  const stack = status?.stack ?? null
  if (!stack || !branch) return null
  const entry = stack.branches.find((b) => b.name === branch)
  if (!entry || entry.position === 0) return null
  return (
    <div className="flex items-center gap-1.5">
      <RiStackLine className="size-3 text-zinc-500" />
      <GraphiteRestackButton repoPath={repoPath} podId={podId} />
    </div>
  )
}

/**
 * Per-pod hook that components can use to decide whether the pod is on a
 * Graphite-tracked stack (vs. just having Graphite enabled at the workspace
 * level).
 */
export function useStackReady(podId: string): boolean {
  const { status } = useGitStatus(podId)
  const stack = status?.stack ?? null
  return !!(stack?.enabled && stack?.installed && stack?.initialized)
}
