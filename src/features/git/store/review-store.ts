import { create } from 'zustand'
import type { ReviewComment, ReviewSide } from '@/types/schema'

/**
 * Ephemeral per-session UI state for review commenting inside the git overlay.
 *
 * Comments themselves live on the server (see `useReviewComments` /
 * `useDraftReview`) so they persist across overlay open/close. Only the user's
 * in-progress draft anchor is tracked here.
 */

export interface DraftAnchor {
  filePath: string
  side: ReviewSide
  startLine: number
  endLine?: number
  /** Snapshot of the anchored line(s) at the moment the draft was opened. */
  anchorContent?: string
}

interface ReviewState {
  podId: string | null
  activeReviewId: string | null
  draftAnchor: DraftAnchor | null

  setPodId: (podId: string | null) => void
  setActiveReviewId: (reviewId: string | null) => void
  setDraftAnchor: (anchor: DraftAnchor | null) => void
}

export const useReviewStore = create<ReviewState>()((set) => ({
  podId: null,
  activeReviewId: null,
  draftAnchor: null,

  setPodId: (podId) => set((s) => (s.podId === podId ? s : { podId, activeReviewId: null, draftAnchor: null })),
  setActiveReviewId: (activeReviewId) => set({ activeReviewId }),
  setDraftAnchor: (draftAnchor) => set({ draftAnchor }),
}))

export function getCommentsForFile(comments: ReviewComment[], filePath: string): ReviewComment[] {
  return comments.filter((c) => c.filePath === filePath)
}

export function getCommentCountByFile(comments: ReviewComment[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of comments) {
    map.set(c.filePath, (map.get(c.filePath) ?? 0) + 1)
  }
  return map
}
