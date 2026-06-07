import { createHash } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { v4 as uuid } from 'uuid'
import { DatabaseService } from '../../infra/database'
import { AppError } from '../../services/errors'
import type { ShellExecFn } from '../git/controller'
import { PodController } from '../pod'
import * as reviewRepo from './repository'
import type { CommentResolution, Review, ReviewComment, ReviewCommentWithResolution } from './types'

type ResolveShellExec = (pod: { cwd: string }) => ShellExecFn | null

/** The referenced review does not exist. */
class ReviewNotFound extends AppError('ReviewNotFound', 'NOT_FOUND')<{
  readonly reviewId: string
}> {}

/** The referenced review comment does not exist. */
class ReviewCommentNotFound extends AppError('ReviewCommentNotFound', 'NOT_FOUND')<{
  readonly commentId: string
}> {}

/** The review is already submitted, so its comments are frozen. */
class ReviewNotDraft extends AppError('ReviewNotDraft', 'CONFLICT')<{
  readonly reviewId: string
}> {}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

interface ReviewControllerShape {
  readonly getOrCreateDraft: (input: { podId: string; baseRef?: string | null }) => Effect.Effect<Review>
  readonly listReviews: (podId: string) => Effect.Effect<Review[]>
  readonly listComments: (reviewId: string) => Effect.Effect<ReviewComment[]>
  readonly addComment: (input: {
    reviewId: string
    filePath: string
    side: 'additions' | 'deletions'
    startLine: number
    endLine?: number | null
    body: string
    anchorContent?: string | null
  }) => Effect.Effect<ReviewComment, ReviewNotFound | ReviewNotDraft>
  readonly updateComment: (
    commentId: string,
    body: string,
  ) => Effect.Effect<ReviewComment, ReviewCommentNotFound | ReviewNotDraft>
  readonly removeComment: (commentId: string) => Effect.Effect<{ removed: boolean }, ReviewNotDraft>
  readonly submitReview: (
    input: { reviewId: string; summary?: string | null },
    resolveShellExec: ResolveShellExec,
  ) => Effect.Effect<Review, ReviewNotFound>
  readonly getResolutionStatus: (
    reviewId: string,
    resolveShellExec: ResolveShellExec,
  ) => Effect.Effect<ReviewCommentWithResolution[]>
}

export class ReviewController extends Context.Tag('ReviewController')<ReviewController, ReviewControllerShape>() {}

export const ReviewControllerLive = Layer.effect(
  ReviewController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const podSvc = yield* PodController

    return {
      getOrCreateDraft: (input) =>
        Effect.sync(() => {
          const existing = reviewRepo.getDraftReviewByPod(db, input.podId)
          if (existing) return existing
          const now = new Date()
          return reviewRepo.insertDraftReview(db, {
            id: uuid(),
            podId: input.podId,
            baseRef: input.baseRef ?? null,
            now,
          })
        }),
      listReviews: (podId) => Effect.sync(() => reviewRepo.listReviewsByPod(db, podId)),
      listComments: (reviewId) => Effect.sync(() => reviewRepo.listCommentsByReview(db, reviewId)),
      addComment: (input) =>
        Effect.gen(function* () {
          const review = reviewRepo.getReview(db, input.reviewId)
          if (!review) return yield* new ReviewNotFound({ reviewId: input.reviewId, message: 'Review not found' })
          if (review.state !== 'draft') {
            return yield* new ReviewNotDraft({
              reviewId: input.reviewId,
              message: 'Cannot add comments to a submitted review',
            })
          }

          const now = new Date()
          const anchorContent = input.anchorContent ?? null
          return reviewRepo.insertReviewComment(db, {
            id: uuid(),
            reviewId: input.reviewId,
            filePath: input.filePath,
            side: input.side,
            startLine: input.startLine,
            endLine: input.endLine ?? null,
            anchorContent,
            anchorHash: anchorContent != null ? sha256(anchorContent) : null,
            body: input.body,
            now,
          })
        }),
      updateComment: (commentId, body) =>
        Effect.gen(function* () {
          const existing = reviewRepo.getReviewComment(db, commentId)
          if (!existing) return yield* new ReviewCommentNotFound({ commentId, message: 'Comment not found' })
          const review = reviewRepo.getReview(db, existing.reviewId)
          if (!review || review.state !== 'draft') {
            return yield* new ReviewNotDraft({
              reviewId: existing.reviewId,
              message: 'Cannot edit a comment on a submitted review',
            })
          }
          return reviewRepo.updateReviewCommentBody(db, commentId, body, new Date())!
        }),
      removeComment: (commentId) =>
        Effect.gen(function* () {
          const existing = reviewRepo.getReviewComment(db, commentId)
          if (!existing) return { removed: false }
          const review = reviewRepo.getReview(db, existing.reviewId)
          if (!review || review.state !== 'draft') {
            return yield* new ReviewNotDraft({
              reviewId: existing.reviewId,
              message: 'Cannot delete a comment on a submitted review',
            })
          }
          return { removed: reviewRepo.deleteReviewComment(db, commentId, new Date()) }
        }),
      submitReview: (input, resolveShellExec) =>
        Effect.gen(function* () {
          const review = reviewRepo.getReview(db, input.reviewId)
          if (!review) return yield* new ReviewNotFound({ reviewId: input.reviewId, message: 'Review not found' })
          if (review.state === 'submitted') return review

          const pod = yield* podSvc.getById(review.podId)

          let headCommit: string | null = null
          if (pod) {
            const repoPath = pod.gitContext?.repoPath ?? pod.cwd
            const shellExec = resolveShellExec(pod)
            if (shellExec) {
              const res = yield* Effect.promise(() =>
                shellExec({ command: `git -C ${shellQuote(repoPath)} rev-parse HEAD` }),
              )
              if (res.exitCode === 0) {
                const trimmed = res.stdout.trim()
                if (trimmed) headCommit = trimmed
              }
            }
          }

          const now = new Date()
          return reviewRepo.submitReview(db, {
            reviewId: input.reviewId,
            summary: input.summary ?? null,
            headCommit,
            now,
          })
        }),
      getResolutionStatus: (reviewId, resolveShellExec) =>
        Effect.gen(function* () {
          const review = reviewRepo.getReview(db, reviewId)
          if (!review) return []

          const comments = reviewRepo.listCommentsByReview(db, reviewId)
          if (comments.length === 0) return []

          const pod = yield* podSvc.getById(review.podId)
          if (!pod) {
            return comments.map((comment) => ({
              ...comment,
              resolution: 'unknown' as CommentResolution,
            }))
          }
          const repoPath = pod.gitContext?.repoPath ?? pod.cwd
          const shellExec = resolveShellExec(pod)
          if (!shellExec) {
            return comments.map((comment) => ({
              ...comment,
              resolution: 'unknown' as CommentResolution,
            }))
          }

          const byFile = new Map<string, typeof comments>()
          for (const comment of comments) {
            const list = byFile.get(comment.filePath) ?? []
            list.push(comment)
            byFile.set(comment.filePath, list)
          }

          const results: ReviewCommentWithResolution[] = []
          for (const [filePath, list] of byFile) {
            const read = yield* Effect.promise(() =>
              shellExec({ command: `cat ${shellQuote(`${repoPath}/${filePath}`)}` }),
            )
            const lines: string[] | null = read.exitCode === 0 ? read.stdout.split('\n') : null

            for (const commentRow of list) {
              const comment = commentRow
              let resolution: CommentResolution = 'unknown'
              if (lines == null) {
                resolution = commentRow.side === 'additions' ? 'resolved' : 'unknown'
              } else if (commentRow.anchorContent == null) {
                resolution = 'unknown'
              } else {
                const startIdx = commentRow.startLine - 1
                const endIdx = (commentRow.endLine ?? commentRow.startLine) - 1
                if (startIdx < 0 || endIdx >= lines.length) {
                  resolution = 'resolved'
                } else {
                  const currentSlice = lines.slice(startIdx, endIdx + 1).join('\n')
                  if (currentSlice === commentRow.anchorContent) {
                    resolution = 'unresolved'
                  } else {
                    const haystack = lines.join('\n')
                    resolution = haystack.includes(commentRow.anchorContent) ? 'changed' : 'resolved'
                  }
                }
              }
              results.push({ ...comment, resolution })
            }
          }

          const orderMap = new Map(comments.map((comment, i) => [comment.id, i]))
          results.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
          return results
        }),
    }
  }),
)
