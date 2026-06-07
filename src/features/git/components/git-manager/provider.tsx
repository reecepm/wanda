import { useCallback, useMemo, useState } from 'react'
import { useGitCollection } from '@/features/git/hooks/use-git-collection'
import { GitManagerContext, type GitManagerContextValue } from './context'

interface GitManagerProviderProps {
  podId: string
  children: React.ReactNode
}

export function GitManagerProvider({ podId, children }: GitManagerProviderProps) {
  const { collection } = useGitCollection(podId)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const stageFile = useCallback(
    (path: string) => {
      if (collection.has(path)) {
        collection.update(path, (draft) => {
          draft.staged = true
        })
      }
    },
    [collection],
  )

  const unstageFile = useCallback(
    (path: string) => {
      if (collection.has(path)) {
        collection.update(path, (draft) => {
          draft.staged = false
          draft.status = draft.originalStatus
        })
      }
    },
    [collection],
  )

  const value = useMemo<GitManagerContextValue>(
    () => ({ podId, collection, stageFile, unstageFile, selectedFile, setSelectedFile }),
    [podId, collection, stageFile, unstageFile, selectedFile],
  )

  return <GitManagerContext value={value}>{children}</GitManagerContext>
}
