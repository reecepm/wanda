import { and, eq, not } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { use, useMemo } from 'react'
import type { GitFileEntry } from '@/features/git/hooks/use-git-collection'
import { useReviewComments } from '@/features/git/hooks/use-review'
import { getCommentCountByFile, useReviewStore } from '@/features/git/store/review-store'
import { cn } from '@/shared/utils'
import { GitManagerContext } from './context'
import { LineDelta } from './line-delta'
import { StagingIndicator } from './staging-indicator'

/**
 * Subscribes to the active draft review's comment counts. Returns an empty map
 * when no review is active, so callers can render unconditionally.
 */
function useCommentCounts(): Map<string, number> {
  const activeReviewId = useReviewStore((s) => s.activeReviewId)
  const { comments } = useReviewComments(activeReviewId)
  return useMemo(() => getCommentCountByFile(comments), [comments])
}

export function FileList({ children }: { children: React.ReactNode }) {
  const { collection } = use(GitManagerContext)!
  const { data: allFiles = [] } = useLiveQuery((q) => q.from({ f: collection }), [collection])
  const isEmpty = allFiles.length === 0

  return (
    <div className="flex-1 overflow-y-auto">
      {isEmpty && <div className="px-3 py-8 text-xs text-zinc-600 text-center">No changes</div>}
      {children}
    </div>
  )
}

export function StagedSection() {
  const { collection, unstageFile } = use(GitManagerContext)!
  const { data: files = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => eq(f.staged, true)),
    [collection],
  )

  if (files.length === 0) return null
  return (
    <FileSection
      title="Staged Changes"
      files={files as GitFileEntry[]}
      staged
      onToggle={unstageFile}
      onBulkAction="unstageAll"
    />
  )
}

export function UnstagedSection() {
  const { collection, stageFile } = use(GitManagerContext)!
  const { data: files = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => and(eq(f.staged, false), not(eq(f.originalStatus, 'untracked')))),
    [collection],
  )

  if (files.length === 0) return null
  return (
    <FileSection
      title="Changes"
      files={files as GitFileEntry[]}
      staged={false}
      onToggle={stageFile}
      onBulkAction="stageAll"
    />
  )
}

export function UntrackedSection() {
  const { collection, stageFile } = use(GitManagerContext)!
  const { data: files = [] } = useLiveQuery(
    (q) => q.from({ f: collection }).where(({ f }) => and(eq(f.originalStatus, 'untracked'), eq(f.staged, false))),
    [collection],
  )

  if (files.length === 0) return null
  return (
    <FileSection
      title="Untracked"
      files={files as GitFileEntry[]}
      staged={false}
      onToggle={stageFile}
      onBulkAction="stageAll"
    />
  )
}

function FileSection({
  title,
  files,
  staged,
  onToggle,
  onBulkAction,
}: {
  title: string
  files: GitFileEntry[]
  staged: boolean
  onToggle: (path: string) => void
  onBulkAction: 'stageAll' | 'unstageAll'
}) {
  const ctx = use(GitManagerContext)!
  const { collection } = ctx
  const commentCounts = useCommentCounts()

  const handleBulkAction = useMemo(() => {
    const paths = files.map((f) => f.path)
    if (onBulkAction === 'stageAll') {
      return async () => {
        // Optimistic: batch update all at once (single transaction)
        collection.update(paths, (drafts) => {
          for (const draft of drafts) draft.staged = true
        })
      }
    }
    return async () => {
      collection.update(paths, (drafts) => {
        for (const draft of drafts) {
          draft.staged = false
          draft.status = draft.originalStatus
        }
      })
    }
  }, [onBulkAction, files, collection])

  return (
    <div>
      <div className="px-2.5 py-1 flex items-center justify-between sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
          {title} <span className="text-zinc-600">{files.length}</span>
        </span>
        <button
          type="button"
          onClick={handleBulkAction}
          className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          {staged ? 'Unstage all' : 'Stage all'}
        </button>
      </div>
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f as GitFileEntry}
          staged={staged}
          onToggle={() => onToggle(f.path)}
          onSelect={() => {
            const { selectedFile, setSelectedFile } = ctx
            setSelectedFile(selectedFile === f.path ? null : f.path)
          }}
          selected={ctx.selectedFile === f.path}
          commentCount={commentCounts.get(f.path) ?? 0}
        />
      ))}
    </div>
  )
}

function FileRow({
  file,
  staged,
  selected,
  onToggle,
  onSelect,
  commentCount,
}: {
  file: GitFileEntry
  staged: boolean
  selected: boolean
  onToggle: () => void
  onSelect: () => void
  commentCount?: number
}) {
  const fileName = file.path.split('/').pop() ?? file.path
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null

  return (
    <div
      className={cn(
        'flex items-center gap-2 w-full px-2.5 py-[3px] transition-colors group cursor-pointer',
        selected ? 'bg-zinc-800' : 'hover:bg-zinc-800/50',
      )}
      onClick={onSelect}
    >
      <StagingIndicator staged={staged} status={file.status} onClick={onToggle} />
      <div className="flex items-center min-w-0 flex-1 overflow-hidden">
        <span className={cn('text-[11px] shrink-0', selected ? 'text-zinc-200' : 'text-zinc-400')}>{fileName}</span>
        {dir && <span className="text-[10px] text-zinc-600 ml-1.5 truncate shrink">{dir}</span>}
      </div>
      {commentCount && commentCount > 0 ? (
        <span
          className="flex items-center gap-1 shrink-0"
          title={`${commentCount} review comment${commentCount === 1 ? '' : 's'}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
          <span className="text-[10px] text-purple-400">{commentCount}</span>
        </span>
      ) : null}
      <LineDelta
        additions={file.additions ?? 0}
        deletions={file.deletions ?? 0}
        className="text-[9px] shrink-0 opacity-70"
      />
    </div>
  )
}
