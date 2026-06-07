import { createCollection, eq } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { useLiveQuery } from '@tanstack/react-db'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { FileStatus } from '@/features/git/utils/git-status'
import { orpcUtils } from '@/shared/orpc'

export interface GitFileEntry {
  path: string
  status: FileStatus
  /** The status git reported when the file was last fetched — used to restore correct section after unstage */
  originalStatus: FileStatus
  staged: boolean
  additions: number
  deletions: number
}

function buildCollectionOptions(
  podId: string,
  queryClient: ReturnType<typeof useQueryClient>,
  collectionRef: { current: FilesCollection | null },
) {
  return queryCollectionOptions({
    id: `git-files-${podId}`,
    queryKey: orpcUtils.git.getStatus.key({ input: { podId } }),
    queryFn: async () => {
      const [statusResult, diffResult] = await Promise.all([
        orpcUtils.git.getStatus.call({ podId }),
        orpcUtils.git.getDiff.call({ podId, mode: 'uncommitted' }),
      ])

      if (!statusResult) return []

      const lineCountMap = new Map<string, { additions: number; deletions: number }>()
      if (diffResult?.files) {
        for (const f of diffResult.files) {
          lineCountMap.set(f.path, { additions: f.additions, deletions: f.deletions })
        }
      }

      // For files already in the collection, preserve their originalStatus
      // so optimistic stage→unstage cycles don't lose the "was untracked" info
      const existing = collectionRef.current

      const entries: GitFileEntry[] = []
      const seen = new Set<string>()

      for (const f of statusResult.staged) {
        const lc = lineCountMap.get(f.path)
        // A staged file with status 'added' might be a formerly-untracked file.
        // Check if the collection already knows it was untracked.
        const prev = existing?.get(f.path)
        const originalStatus = prev?.originalStatus === 'untracked' ? 'untracked' : f.status
        entries.push({
          path: f.path,
          status: f.status,
          originalStatus,
          staged: true,
          additions: lc?.additions ?? 0,
          deletions: lc?.deletions ?? 0,
        })
        seen.add(f.path)
      }
      for (const f of statusResult.unstaged) {
        if (seen.has(f.path)) continue
        const lc = lineCountMap.get(f.path)
        entries.push({
          path: f.path,
          status: f.status,
          originalStatus: f.status,
          staged: false,
          additions: lc?.additions ?? 0,
          deletions: lc?.deletions ?? 0,
        })
        seen.add(f.path)
      }
      // Count lines for untracked files (they have no git diff)
      const untrackedPaths = statusResult.untracked.filter((p) => !seen.has(p))
      const untrackedLineCounts = await Promise.all(
        untrackedPaths.map(async (p) => {
          try {
            const content = await orpcUtils.git.getFileContent.call({ podId, filePath: p })
            if (content == null) return 0
            // Count non-empty lines
            return content.split('\n').filter(Boolean).length
          } catch {
            return 0
          }
        }),
      )

      for (let i = 0; i < untrackedPaths.length; i++) {
        const p = untrackedPaths[i]
        if (p == null) continue
        entries.push({
          path: p,
          status: 'untracked',
          originalStatus: 'untracked',
          staged: false,
          additions: untrackedLineCounts[i] ?? 0,
          deletions: 0,
        })
      }

      return entries
    },
    queryClient,
    getKey: (item: GitFileEntry) => item.path,
    staleTime: 5000,

    onUpdate: async ({ transaction }) => {
      const toStage: string[] = []
      const toUnstage: string[] = []

      for (const mutation of transaction.mutations) {
        if (mutation.changes.staged === true && mutation.original.staged === false) {
          toStage.push(mutation.original.path)
        } else if (mutation.changes.staged === false && mutation.original.staged === true) {
          toUnstage.push(mutation.original.path)
        }
      }

      if (toStage.length > 0) await orpcUtils.git.stageFiles.call({ podId, files: toStage })
      if (toUnstage.length > 0) await orpcUtils.git.unstageFiles.call({ podId, files: toUnstage })

      return { refetch: true }
    },
  })
}

// Derive the concrete collection type — the extra param doesn't affect the return type
function _makeCollection(opts: ReturnType<typeof buildCollectionOptions>) {
  return createCollection(opts)
}
type FilesCollection = ReturnType<typeof _makeCollection>

export function useGitCollection(podId: string) {
  const queryClient = useQueryClient()

  const collection = useMemo(() => {
    const collectionHolder: { current: FilesCollection | null } = { current: null }
    const nextCollection = createCollection(buildCollectionOptions(podId, queryClient, collectionHolder))
    collectionHolder.current = nextCollection
    return nextCollection
  }, [podId, queryClient])

  const { data: stagedFiles = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => eq(f.staged, true)),
    [collection],
  )

  const { data: allUnstagedFiles = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => eq(f.staged, false)),
    [collection],
  )

  const { unstaged, untracked } = useMemo(() => {
    const unstaged: GitFileEntry[] = []
    const untracked: GitFileEntry[] = []
    for (const f of allUnstagedFiles) {
      const entry = f as GitFileEntry
      // Use originalStatus to determine section — this survives optimistic stage/unstage cycles
      if (entry.originalStatus === 'untracked') untracked.push(entry)
      else unstaged.push(entry)
    }
    return { unstaged, untracked }
  }, [allUnstagedFiles])

  const allFiles = useMemo(
    () => [...(stagedFiles as GitFileEntry[]), ...unstaged, ...untracked],
    [stagedFiles, unstaged, untracked],
  )

  const totalAdditions = useMemo(() => allFiles.reduce((s, f) => s + f.additions, 0), [allFiles])
  const totalDeletions = useMemo(() => allFiles.reduce((s, f) => s + f.deletions, 0), [allFiles])

  return {
    collection,
    files: allFiles,
    stagedFiles: stagedFiles as GitFileEntry[],
    unstagedFiles: unstaged,
    untrackedFiles: untracked,
    totalAdditions,
    totalDeletions,
  }
}
