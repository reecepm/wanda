import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RiCheckLine, RiCloseLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'

interface GitContextSelectorProps {
  podId: string
  onClose: () => void
}

export function GitContextSelector({ podId, onClose }: GitContextSelectorProps) {
  const queryClient = useQueryClient()
  const { data: pod } = useQuery(orpcUtils.pod.getById.queryOptions({ input: { id: podId } }))
  const gitContext = pod?.gitContext as { repoPath: string; baseRef?: string; source: 'auto' | 'user' } | null

  const [customPath, setCustomPath] = useState(gitContext?.repoPath ?? '')

  async function handleSetPath() {
    if (!customPath.trim()) return
    await orpcUtils.git.setContext.call({
      podId,
      gitContext: {
        repoPath: customPath.trim(),
        source: 'user',
      },
    })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getDiff.key({ input: { podId } }) })
    onClose()
  }

  async function handleClear() {
    await orpcUtils.git.setContext.call({ podId, gitContext: null })
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getDiff.key({ input: { podId } }) })
    onClose()
  }

  async function handleRediscover() {
    const result = await orpcUtils.git.discover.call({ podId })
    if (result) {
      await orpcUtils.git.setContext.call({
        podId,
        gitContext: {
          repoPath: result.repoPath,
          source: 'auto',
        },
      })
    }
    queryClient.invalidateQueries({ queryKey: orpcUtils.pod.getById.key({ input: { id: podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getStatus.key({ input: { podId } }) })
    queryClient.invalidateQueries({ queryKey: orpcUtils.git.getDiff.key({ input: { podId } }) })
    onClose()
  }

  return (
    <div className="border-b border-zinc-800 p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-zinc-500">Git repo path</span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
        >
          <RiCloseLine className="h-3 w-3" />
        </button>
      </div>

      {gitContext && (
        <div className="text-[10px] text-zinc-500">
          Current: <span className="text-zinc-400">{gitContext.repoPath}</span>
          <span className="ml-1 text-zinc-600">({gitContext.source})</span>
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          type="text"
          value={customPath}
          onChange={(e) => setCustomPath(e.target.value)}
          placeholder="/path/to/repo"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md text-[11px] text-zinc-300 px-2 py-1 outline-none focus:border-zinc-600"
          onKeyDown={(e) => e.key === 'Enter' && handleSetPath()}
        />
        <button
          type="button"
          onClick={handleSetPath}
          className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400"
          title="Set path"
        >
          <RiCheckLine className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={handleRediscover} className="text-[10px] text-blue-400 hover:text-blue-300">
          Re-discover
        </button>
        {gitContext && (
          <button type="button" onClick={handleClear} className="text-[10px] text-red-400 hover:text-red-300">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
