import { z } from 'zod'
import { ReviewController } from '../../services'
import type { AppRouterDeps } from '../index'

const sideSchema = z.enum(['additions', 'deletions'])

export function reviewRoutes({ effectOs, resolveShellExec }: AppRouterDeps) {
  return {
    /**
     * Returns the pod's current draft review, creating one if none exists.
     * At most one draft per pod at a time.
     */
    getOrCreateDraft: effectOs.input(z.object({ podId: z.string(), baseRef: z.string().nullish() })).effect(function* ({
      input,
    }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.getOrCreateDraft(input)
    }),

    /**
     * List all reviews for a pod (most recent first). Used by the history
     * panel to show prior submitted reviews + the current draft.
     */
    listReviews: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.listReviews(input.podId)
    }),

    listComments: effectOs.input(z.object({ reviewId: z.string() })).effect(function* ({ input }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.listComments(input.reviewId)
    }),

    addComment: effectOs
      .input(
        z.object({
          reviewId: z.string(),
          filePath: z.string(),
          side: sideSchema,
          startLine: z.number().int().nonnegative(),
          endLine: z.number().int().nonnegative().nullish(),
          body: z.string().min(1),
          anchorContent: z.string().nullish(),
        }),
      )
      .effect(function* ({ input }) {
        const reviewSvc = yield* ReviewController
        return yield* reviewSvc.addComment(input)
      }),

    updateComment: effectOs.input(z.object({ commentId: z.string(), body: z.string().min(1) })).effect(function* ({
      input,
    }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.updateComment(input.commentId, input.body)
    }),

    removeComment: effectOs.input(z.object({ commentId: z.string() })).effect(function* ({ input }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.removeComment(input.commentId)
    }),

    /**
     * Freeze the draft review. Snapshots the current HEAD commit so the
     * comments stay anchored to a specific version of the codebase.
     */
    submitReview: effectOs.input(z.object({ reviewId: z.string(), summary: z.string().nullish() })).effect(function* ({
      input,
    }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.submitReview(input, resolveShellExec)
    }),

    /**
     * Compute resolution status for each comment in a review by comparing
     * anchored line content against the current working-tree file. Meant
     * for the history panel — the active draft doesn't need this.
     *
     * Returns comments augmented with a `resolution` field.
     */
    getResolutionStatus: effectOs.input(z.object({ reviewId: z.string() })).effect(function* ({ input }) {
      const reviewSvc = yield* ReviewController
      return yield* reviewSvc.getResolutionStatus(input.reviewId, resolveShellExec)
    }),
  }
}
