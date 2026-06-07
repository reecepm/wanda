import { useCallback, useEffect, useRef } from 'react'
import { useAddComment } from '@/features/git/hooks/use-review'
import { useReviewStore } from '@/features/git/store/review-store'
import type { ReviewSide } from '@/types/schema'

interface ReviewCommentFormProps {
  filePath: string
  side: ReviewSide
  startLine: number
  endLine?: number
  anchorContent?: string
}

export function ReviewCommentForm({ filePath, side, startLine, endLine, anchorContent }: ReviewCommentFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const activeReviewId = useReviewStore((s) => s.activeReviewId)
  const setDraftAnchor = useReviewStore((s) => s.setDraftAnchor)
  const addMutation = useAddComment(activeReviewId)

  useEffect(() => {
    // Small delay so the annotation container is fully rendered before focusing
    const t = setTimeout(() => textareaRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const handleSave = useCallback(() => {
    const body = textareaRef.current?.value.trim()
    if (!body || !activeReviewId) return
    addMutation.mutate(
      { filePath, side, startLine, endLine, body, anchorContent },
      {
        onSuccess: () => {
          setDraftAnchor(null)
        },
      },
    )
  }, [activeReviewId, addMutation, filePath, side, startLine, endLine, anchorContent, setDraftAnchor])

  const handleCancel = useCallback(() => {
    setDraftAnchor(null)
  }, [setDraftAnchor])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSave()
      } else if (e.key === 'Escape') {
        // Escape inside the comment input cancels the in-progress comment
        // without bubbling up to close the whole git overlay.
        e.preventDefault()
        e.stopPropagation()
        handleCancel()
      }
    },
    [handleSave, handleCancel],
  )

  return (
    <div className="flex flex-col gap-1.5 p-2 mx-1 my-1 bg-zinc-800/80 border border-purple-500/20 rounded-md">
      <textarea
        ref={textareaRef}
        rows={2}
        placeholder="Add a review comment..."
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none outline-none focus:border-purple-500/40"
        onKeyDown={handleKeyDown}
      />
      <div className="flex items-center gap-1.5 justify-end">
        <span className="text-[10px] text-zinc-600 mr-auto">⌘↵ save · esc cancel</span>
        <button
          type="button"
          onClick={handleCancel}
          className="px-2 py-0.5 text-[11px] text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={addMutation.isPending || !activeReviewId}
          className="px-2.5 py-0.5 text-[11px] font-medium text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded transition-colors"
        >
          {addMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
