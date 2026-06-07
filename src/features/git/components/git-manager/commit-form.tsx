import { useForm } from '@tanstack/react-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { use } from 'react'
import { toast } from 'sonner'
import { RiCheckLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { GitManagerContext } from './context'

export function CommitForm({ podId, stagedCount }: { podId: string; stagedCount: number }) {
  const queryClient = useQueryClient()
  const { collection, setSelectedFile } = use(GitManagerContext)!

  const commitMutation = useMutation({
    mutationFn: (message: string) => orpcUtils.git.commit.call({ podId, message }),
    onSettled: () => {
      collection.utils.refetch()
      // Invalidate all git queries so diff view refreshes
      queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
      queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey as string[]
          return Array.isArray(key) && key.some((k) => typeof k === 'string' && k.includes('getDiff'))
        },
      })
      // Clear file selection so diff view resets
      setSelectedFile(null)
    },
  })

  const form = useForm({
    defaultValues: { message: '' },
    onSubmit: async ({ value }) => {
      if (!value.message.trim() || stagedCount === 0) return
      commitMutation.mutate(value.message.trim(), {
        onSuccess: (result) => {
          form.reset()
          toast.success(`Committed ${result.hash}`)
        },
        onError: (err) => toast.error(`Commit failed: ${err.message}`),
      })
    },
  })

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
            placeholder="Commit message..."
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
      <Button
        type="submit"
        variant="outline"
        size="xs"
        disabled={stagedCount === 0 || commitMutation.isPending}
        className="w-full"
      >
        {commitMutation.isPending ? <RiLoader4Line className="animate-spin" /> : <RiCheckLine />}
        Commit{stagedCount > 0 ? ` (${stagedCount})` : ''}
      </Button>
    </form>
  )
}
