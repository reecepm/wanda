import { and, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { reviewComments, reviews } from '../../../db/schema'
import type { Review, ReviewComment } from '../types'

function rowToReview(row: typeof reviews.$inferSelect): Review {
  return {
    id: row.id,
    podId: row.podId,
    state: row.state,
    baseRef: row.baseRef,
    headCommit: row.headCommit,
    summary: row.summary,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    submittedAt: row.submittedAt ? row.submittedAt.getTime() : null,
  }
}

export function rowToComment(row: typeof reviewComments.$inferSelect): ReviewComment {
  return {
    id: row.id,
    reviewId: row.reviewId,
    filePath: row.filePath,
    side: row.side,
    startLine: row.startLine,
    endLine: row.endLine,
    anchorContent: row.anchorContent,
    anchorHash: row.anchorHash,
    body: row.body,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

export function getDraftReviewByPod(db: AppDatabase, podId: string) {
  const row = db
    .select()
    .from(reviews)
    .where(and(eq(reviews.podId, podId), eq(reviews.state, 'draft')))
    .orderBy(desc(reviews.createdAt))
    .get()
  return row ? rowToReview(row) : null
}

export function insertDraftReview(
  db: AppDatabase,
  input: {
    id: string
    podId: string
    baseRef?: string | null
    now: Date
  },
) {
  db.insert(reviews)
    .values({
      id: input.id,
      podId: input.podId,
      state: 'draft',
      baseRef: input.baseRef ?? null,
      headCommit: null,
      summary: null,
      createdAt: input.now,
      updatedAt: input.now,
      submittedAt: null,
    })
    .run()
  return getReview(db, input.id)!
}

export function listReviewsByPod(db: AppDatabase, podId: string) {
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.podId, podId))
    .orderBy(desc(reviews.createdAt))
    .all()
    .map(rowToReview)
}

export function getReview(db: AppDatabase, reviewId: string) {
  const row = db.select().from(reviews).where(eq(reviews.id, reviewId)).get()
  return row ? rowToReview(row) : null
}

export function listCommentsByReview(db: AppDatabase, reviewId: string) {
  return db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.reviewId, reviewId))
    .orderBy(reviewComments.createdAt)
    .all()
    .map(rowToComment)
}

export function getReviewComment(db: AppDatabase, commentId: string) {
  const row = db.select().from(reviewComments).where(eq(reviewComments.id, commentId)).get()
  return row ? rowToComment(row) : null
}

export function insertReviewComment(
  db: AppDatabase,
  input: {
    id: string
    reviewId: string
    filePath: string
    side: 'additions' | 'deletions'
    startLine: number
    endLine?: number | null
    anchorContent?: string | null
    anchorHash?: string | null
    body: string
    now: Date
  },
) {
  db.insert(reviewComments)
    .values({
      id: input.id,
      reviewId: input.reviewId,
      filePath: input.filePath,
      side: input.side,
      startLine: input.startLine,
      endLine: input.endLine ?? null,
      anchorContent: input.anchorContent ?? null,
      anchorHash: input.anchorHash ?? null,
      body: input.body,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run()
  touchReview(db, input.reviewId, input.now)
  return getReviewComment(db, input.id)!
}

export function updateReviewCommentBody(db: AppDatabase, commentId: string, body: string, now: Date) {
  const existing = getReviewComment(db, commentId)
  if (!existing) return null
  db.update(reviewComments).set({ body, updatedAt: now }).where(eq(reviewComments.id, commentId)).run()
  touchReview(db, existing.reviewId, now)
  return getReviewComment(db, commentId)!
}

export function deleteReviewComment(db: AppDatabase, commentId: string, now: Date) {
  const existing = getReviewComment(db, commentId)
  if (!existing) return false
  db.delete(reviewComments).where(eq(reviewComments.id, commentId)).run()
  touchReview(db, existing.reviewId, now)
  return true
}

export function submitReview(
  db: AppDatabase,
  input: {
    reviewId: string
    summary?: string | null
    headCommit?: string | null
    now: Date
  },
) {
  db.update(reviews)
    .set({
      state: 'submitted',
      summary: input.summary ?? null,
      headCommit: input.headCommit ?? null,
      submittedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(reviews.id, input.reviewId))
    .run()
  return getReview(db, input.reviewId)!
}

function touchReview(db: AppDatabase, reviewId: string, now: Date) {
  db.update(reviews).set({ updatedAt: now }).where(eq(reviews.id, reviewId)).run()
}
