import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useViewedFilesStore } from '@/features/git/store/viewed-files-store'
import { orpcUtils } from '@/shared/orpc'

/**
 * Hydrates the local viewed-files store from the server for the given pod
 * and set of file paths. The server returns only files whose stored content
 * hash still matches the current file content — meaning drifted files are
 * automatically "unviewed".
 */
export function useHydrateViewedFiles(podId: string, filePaths: string[]) {
  const setViewedForPod = useViewedFilesStore((s) => s.setViewedForPod)

  const sortedPaths = useMemo(() => [...filePaths].sort(), [filePaths])

  const { data } = useQuery({
    ...orpcUtils.git.listViewedFiles.queryOptions({
      input: { podId, filePaths: sortedPaths },
    }),
    enabled: sortedPaths.length > 0,
    staleTime: 5000,
  })

  useEffect(() => {
    if (data) setViewedForPod(podId, data)
  }, [data, podId, setViewedForPod])
}

/**
 * Returns a toggle function that persists the viewed state to the server
 * and optimistically updates the local store.
 *
 * We intentionally do NOT invalidate `listViewedFiles` on settle — that
 * triggers a refetch which replaces the whole pod's viewed set via
 * `setViewedForPod`, racing against and clobbering the optimistic flip
 * (and the server's own response for this file). Instead we mirror the
 * authoritative `viewed` flag from the mutation result onto the local
 * store. Hash-drift re-hydration still happens naturally on mount /
 * refocus via `useHydrateViewedFiles`.
 */
export function useToggleFileViewed(podId: string) {
  const setViewedLocal = useViewedFilesStore((s) => s.setViewedLocal)

  const mutation = useMutation({
    mutationFn: (filePath: string) => orpcUtils.git.toggleFileViewed.call({ podId, filePath }),
    onMutate: (filePath) => {
      const currentlyViewed = useViewedFilesStore.getState().isViewed(podId, filePath)
      setViewedLocal(podId, filePath, !currentlyViewed)
      return { previousViewed: currentlyViewed }
    },
    onSuccess: (result, filePath) => {
      setViewedLocal(podId, filePath, result.viewed)
    },
    onError: (_err, filePath, ctx) => {
      if (ctx) setViewedLocal(podId, filePath, ctx.previousViewed)
    },
  })

  return mutation.mutate
}
