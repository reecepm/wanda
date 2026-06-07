import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { WandaLogo } from '@/features/icons'
import { RiArrowRightLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'

export function WelcomePage() {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const createWorkspaceMutation = useMutation({
    ...orpcUtils.workspace.create.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: orpcUtils.workspace.list.key(),
      })
      setCreating(false)
      setName('')
    },
  })

  function handleCreate() {
    if (!name.trim() || createWorkspaceMutation.isPending) return
    createWorkspaceMutation.mutate({ name: name.trim(), cwd: '' })
  }

  function startCreating() {
    setCreating(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-full bg-zinc-800/50 p-4">
            <WandaLogo className="size-8 text-zinc-400" />
          </div>
          <h1 className="font-semibold text-lg text-zinc-200">Welcome to Wanda</h1>
          <p className="text-zinc-500 text-xs leading-relaxed">
            Organize your terminals into workspaces and pods. Each pod groups related terminals that start and stop
            together.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="rounded-md bg-zinc-800/50 px-2 py-1 text-zinc-400">Create a workspace</span>
          <RiArrowRightLine className="size-3 shrink-0 text-zinc-700" />
          <span className="rounded-md bg-zinc-800/50 px-2 py-1 text-zinc-400">Add a pod</span>
          <RiArrowRightLine className="size-3 shrink-0 text-zinc-700" />
          <span className="rounded-md bg-zinc-800/50 px-2 py-1 text-zinc-400">Start coding</span>
        </div>

        {!creating ? (
          <button
            type="button"
            onClick={startCreating}
            className="rounded-md bg-zinc-200 px-4 py-2 font-medium text-sm text-zinc-900 transition-colors hover:bg-zinc-100"
          >
            Create Your First Workspace
          </button>
        ) : (
          <div className="flex w-full items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreate()
                if (event.key === 'Escape') {
                  setCreating(false)
                  setName('')
                }
              }}
              placeholder="Workspace name"
              className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 outline-none focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={!name.trim() || createWorkspaceMutation.isPending}
              className="h-8 rounded-md bg-zinc-200 px-4 font-medium text-sm text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50"
            >
              {createWorkspaceMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
