import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useReviewStore } from '@/features/git/store/review-store'
import { orpcUtils } from '@/shared/orpc'
import type { Review, ReviewComment, ReviewSide } from '@/types/schema'

/**
 * Fetches (or creates) the pod's current draft review. Syncs the review id
 * into the store so child components can reach it without prop-drilling.
 */
export function useDraftReview(podId: string) {
  const setActiveReviewId = useReviewStore((s) => s.setActiveReviewId)

  const { data, isLoading } = useQuery({
    ...orpcUtils.review.getOrCreateDraft.queryOptions({ input: { podId } }),
    // Drafts don't change behind our back — we own mutations.
    staleTime: Infinity,
  })

  useEffect(() => {
    setActiveReviewId(data?.id ?? null)
  }, [data?.id, setActiveReviewId])

  return { review: data ?? null, isLoading }
}

export function useReviewComments(reviewId: string | null) {
  const { data, isLoading } = useQuery({
    ...orpcUtils.review.listComments.queryOptions({ input: { reviewId: reviewId ?? '' } }),
    enabled: !!reviewId,
    staleTime: 60_000,
  })
  return { comments: data ?? EMPTY_COMMENTS, isLoading }
}
const EMPTY_COMMENTS: ReviewComment[] = []

export function useAddComment(reviewId: string | null) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (input: {
      filePath: string
      side: ReviewSide
      startLine: number
      endLine?: number
      body: string
      anchorContent?: string
    }) => {
      if (!reviewId) throw new Error('No active review')
      return orpcUtils.review.addComment.call({ reviewId, ...input })
    },
    onSuccess: () => {
      if (reviewId) {
        qc.invalidateQueries({
          queryKey: orpcUtils.review.listComments.key({ input: { reviewId } }),
        })
        qc.invalidateQueries({ queryKey: orpcUtils.review.listReviews.key() })
      }
    },
  })
  return mutation
}

export function useUpdateComment(reviewId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; body: string }) => orpcUtils.review.updateComment.call(input),
    onSuccess: () => {
      if (reviewId) {
        qc.invalidateQueries({
          queryKey: orpcUtils.review.listComments.key({ input: { reviewId } }),
        })
      }
    },
  })
}

export function useRemoveComment(reviewId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => orpcUtils.review.removeComment.call({ commentId }),
    onSuccess: () => {
      if (reviewId) {
        qc.invalidateQueries({
          queryKey: orpcUtils.review.listComments.key({ input: { reviewId } }),
        })
      }
    },
  })
}

export function useSubmitReview(podId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { reviewId: string; summary?: string }) => orpcUtils.review.submitReview.call(input),
    onSuccess: (submitted: Review) => {
      qc.invalidateQueries({
        queryKey: orpcUtils.review.getOrCreateDraft.key({ input: { podId } }),
      })
      qc.invalidateQueries({
        queryKey: orpcUtils.review.listReviews.key({ input: { podId } }),
      })
      qc.invalidateQueries({
        queryKey: orpcUtils.review.listComments.key({ input: { reviewId: submitted.id } }),
      })
    },
  })
}

export function useReviews(podId: string) {
  const { data, isLoading } = useQuery({
    ...orpcUtils.review.listReviews.queryOptions({ input: { podId } }),
    staleTime: 30_000,
  })
  return { reviews: data ?? EMPTY_REVIEWS, isLoading }
}
const EMPTY_REVIEWS: Review[] = []

export function useResolutionStatus(reviewId: string | null) {
  const { data, isLoading } = useQuery({
    ...orpcUtils.review.getResolutionStatus.queryOptions({ input: { reviewId: reviewId ?? '' } }),
    enabled: !!reviewId,
    staleTime: 10_000,
  })
  return { comments: data, isLoading }
}
