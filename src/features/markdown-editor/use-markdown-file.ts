import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onFileChange, unwatchFile, watchFile } from '@/shared/app-bridge'
import { orpcUtils } from '@/shared/orpc'

export interface MarkdownFileState {
  /** Initial content loaded from disk — drives editor creation. */
  initialContent: string | null
  /** True while the initial read is in flight. */
  isLoading: boolean
  /** Error from the initial read, if any. */
  error: Error | null
  /** mtime (ms) of the last content we loaded OR successfully wrote. */
  lastKnownMtime: number
  /** True when the watcher has seen an external change since our last load/write. */
  hasExternalChange: boolean
  /** Save the given content to disk. Returns the new mtime or throws. */
  save: (content: string) => Promise<number>
  /** Discard any in-memory edits and reload from disk. Returns new content. */
  reload: () => Promise<string>
  /** Clear the external-change flag (caller should reload or force-save before). */
  clearExternalChange: () => void
}

/**
 * Loads a markdown file for editing, watches it for external changes, and
 * exposes a save mutation.
 *
 * The caller is responsible for driving an editor with `initialContent`, tracking
 * the user's dirty state, and calling `save` (autosave debouncing lives in the
 * editor component, not here, so we don't fight with its value state).
 */
export function useMarkdownFile(podId: string, relPath: string): MarkdownFileState {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['file.read', podId, relPath] as const, [podId, relPath])

  const query = useQuery({
    queryKey,
    queryFn: () => orpcUtils.file.read.call({ podId, relPath }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const writeMutation = useMutation({
    mutationFn: (content: string) => orpcUtils.file.write.call({ podId, relPath, content }),
  })

  // Track the mtime of the last content we either loaded or wrote ourselves.
  // Watcher events with mtime <= this are our own echo and should be ignored.
  const lastKnownMtimeRef = useRef(0)
  const [hasExternalChange, setHasExternalChange] = useState(false)

  // Seed lastKnownMtime from the initial read.
  useEffect(() => {
    if (query.data && lastKnownMtimeRef.current === 0) {
      lastKnownMtimeRef.current = query.data.mtimeMs
    }
  }, [query.data])

  // Watch the file for external changes.
  useEffect(() => {
    const watchId = `${podId}:${relPath}`
    watchFile(watchId, podId, relPath)
    const unsubscribe = onFileChange(watchId, (mtimeMs) => {
      // Ignore echoes of our own writes (and stale events before we've loaded).
      if (lastKnownMtimeRef.current === 0) return
      if (mtimeMs <= lastKnownMtimeRef.current) return
      setHasExternalChange(true)
    })
    return () => {
      unsubscribe()
      unwatchFile(watchId)
    }
  }, [podId, relPath])

  const save = useCallback(
    async (content: string): Promise<number> => {
      const result = await writeMutation.mutateAsync(content)
      lastKnownMtimeRef.current = result.mtimeMs
      queryClient.setQueryData(queryKey, { content, mtimeMs: result.mtimeMs })
      // Our own write shouldn't count as an external change.
      setHasExternalChange(false)
      return result.mtimeMs
    },
    [queryClient, queryKey, writeMutation],
  )

  const reload = useCallback(async (): Promise<string> => {
    const fresh = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => orpcUtils.file.read.call({ podId, relPath }),
    })
    lastKnownMtimeRef.current = fresh.mtimeMs
    setHasExternalChange(false)
    return fresh.content
  }, [queryClient, queryKey, podId, relPath])

  const clearExternalChange = useCallback(() => {
    setHasExternalChange(false)
  }, [])

  return {
    initialContent: query.data?.content ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    lastKnownMtime: query.data?.mtimeMs ?? 0,
    hasExternalChange,
    save,
    reload,
    clearExternalChange,
  }
}
