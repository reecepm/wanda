import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { useGitStatus } from '@/features/git/hooks/use-git-status'
import { RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import type { GitContext } from './context'

export function PRForm({ podId, onCancel }: { podId: string; onCancel: () => void }) {
  const queryClient = useQueryClient()
  const [pushing, setPushing] = useState(false)

  const { status: gitStatus, refresh: refreshGitStatus } = useGitStatus(podId)
  const { data: branches } = useQuery({
    ...orpcUtils.git.listBranches.queryOptions({ input: { podId } }),
    staleTime: 30000,
  })
  const pod = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } })).data
  const gitContext = pod?.gitContext as GitContext | null
  const repoPath = gitContext?.repoPath ?? pod?.cwd ?? null
  const hasUpstream = !!gitStatus?.local.upstream
  const ahead = gitStatus?.local.ahead ?? 0
  const needsPush = !hasUpstream || ahead > 0

  const createPRMutation = useMutation({
    mutationFn: async (opts: { title: string; body?: string; baseBranch?: string; draft?: boolean }) => {
      // Auto-push if branch isn't on remote yet or has unpushed commits
      if (needsPush) {
        setPushing(true)
        const pushResult = await orpcUtils.git.push.call({ podId })
        setPushing(false)
        if (!pushResult.success) {
          throw new Error(`Push failed: ${pushResult.error}`)
        }
        // Refresh status so upstream is detected
        void refreshGitStatus()
      }
      return orpcUtils.app.createPR.call({ repoPath: repoPath!, ...opts })
    },
    onSettled: () => {
      setPushing(false)
      if (repoPath) queryClient.invalidateQueries({ queryKey: orpcUtils.app.getPRStatus.key({ input: { repoPath } }) })
    },
  })

  const form = useForm({
    defaultValues: {
      title: (gitStatus?.local.branch ?? '').replace(/^[^/]+\//, '').replace(/[-_]/g, ' '),
      body: '',
      baseBranch: gitContext?.baseRef ?? '',
      draft: false,
    },
    onSubmit: async ({ value }) => {
      if (!value.title.trim()) return
      createPRMutation.mutate(
        {
          title: value.title.trim(),
          body: value.body.trim() || undefined,
          baseBranch: value.baseBranch || undefined,
          draft: value.draft || undefined,
        },
        {
          onSuccess: (result) => {
            toast.success(`PR #${result.number} created`)
            onCancel()
            form.reset()
          },
          onError: (err) => toast.error(`Failed to create PR: ${err.message}`),
        },
      )
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-1.5"
    >
      <form.Field name="title">
        {(field) => (
          <input
            type="text"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="PR title"
            className="w-full h-7 bg-zinc-800 border border-zinc-700 rounded-md px-2 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
        )}
      </form.Field>
      <form.Field name="body">
        {(field) => (
          <textarea
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none"
          />
        )}
      </form.Field>
      {branches && branches.length > 0 && (
        <form.Field name="baseBranch">
          {(field) => (
            <Select value={field.state.value ?? ''} onValueChange={(v) => field.handleChange(v ?? '')}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Default base" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Default base</SelectItem>
                {branches
                  .filter((b) => !b.current)
                  .map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </form.Field>
      )}
      <form.Field name="draft">
        {(field) => (
          <label className="flex items-center gap-2 text-[10px] text-zinc-400">
            <Checkbox checked={field.state.value} onCheckedChange={(v) => field.handleChange(!!v)} />
            Draft
          </label>
        )}
      </form.Field>
      <div className="flex gap-1.5">
        <Button type="button" variant="ghost" size="xs" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="outline"
          size="xs"
          className="flex-1"
          disabled={createPRMutation.isPending || pushing}
        >
          {(createPRMutation.isPending || pushing) && <RiLoader4Line className="animate-spin" />}
          {pushing ? 'Pushing...' : needsPush ? 'Push & Create' : 'Create'}
        </Button>
      </div>
    </form>
  )
}
