import { useCallback, useRef, useState } from 'react'
import { useRemoveComment, useUpdateComment } from '@/features/git/hooks/use-review'
import { useReviewStore } from '@/features/git/store/review-store'
import { RiDeleteBinLine, RiPencilLine, RiUser3Fill } from '@/lib/icons'
import type { CommentResolution, ReviewComment } from '@/types/schema'

interface ReviewCommentCardProps {
  comment: ReviewComment
  /** Resolution status shown on historical (submitted) comments. */
  resolution?: CommentResolution
  /** Read-only comments can't be edited or deleted. */
  readOnly?: boolean
}

const RESOLUTION_BADGE: Record<CommentResolution, { label: string; className: string }> = {
  unresolved: { label: 'Unresolved', className: 'text-amber-400 bg-amber-500/10' },
  changed: { label: 'Changed', className: 'text-sky-400 bg-sky-500/10' },
  resolved: { label: 'Resolved', className: 'text-emerald-400 bg-emerald-500/10' },
  unknown: { label: '?', className: 'text-zinc-500 bg-zinc-800' },
}

export function ReviewCommentCard({ comment, resolution, readOnly }: ReviewCommentCardProps) {
  const activeReviewId = useReviewStore((s) => s.activeReviewId)
  const removeMutation = useRemoveComment(activeReviewId)
  const updateMutation = useUpdateComment(activeReviewId)
  const [editing, setEditing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSaveEdit = useCallback(() => {
    const body = textareaRef.current?.value.trim()
    if (!body) return
    updateMutation.mutate({ commentId: comment.id, body }, { onSuccess: () => setEditing(false) })
  }, [updateMutation, comment.id])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSaveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setEditing(false)
      }
    },
    [handleSaveEdit],
  )

  const badge = resolution ? RESOLUTION_BADGE[resolution] : null

  return (
    <div className="group flex items-start gap-2 px-2 py-1.5 mx-1 my-1">
      <div className="flex items-center justify-center h-5 w-5 rounded-full bg-purple-600 shrink-0 mt-0.5">
        <RiUser3Fill className="h-3 w-3 text-white" />
      </div>
      {editing ? (
        <div className="flex flex-col gap-1.5 flex-1">
          <textarea
            ref={textareaRef}
            rows={2}
            defaultValue={comment.body}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none outline-none focus:border-purple-500/40"
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex items-center gap-1.5 justify-end">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending}
              className="px-2.5 py-0.5 text-[11px] font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded transition-colors"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-0.5 flex-1">
            <p className="text-xs text-zinc-200 leading-relaxed pt-0.5">{comment.body}</p>
            {badge && (
              <span className={`self-start text-[9px] font-medium px-1.5 py-px rounded ${badge.className}`}>
                {badge.label}
              </span>
            )}
          </div>
          {!readOnly && (
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Edit"
              >
                <RiPencilLine className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => removeMutation.mutate(comment.id)}
                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
                title="Delete"
              >
                <RiDeleteBinLine className="h-3 w-3" />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
