import { Context, Effect, Layer } from 'effect'
import { v4 as uuid } from 'uuid'
import { Broadcaster } from '../../infra/broadcaster'
import { DatabaseService } from '../../infra/database'
import { AppError } from '../../services/errors'
import * as planRepo from './repository'
import type {
  Plan,
  PlanAuthorKind,
  PlanComment,
  PlanKind,
  PlanLink,
  PlanLinkKind,
  PlanRevision,
  PlanStatus,
  PlanWithMeta,
} from './types'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

interface PlanAuthorInput {
  authorKind: PlanAuthorKind
  authorId: string
}

interface PlanLinkInput {
  kind: PlanLinkKind
  refId: string
  label?: string | null
}

interface ReviewDecision {
  decision: 'approved' | 'changes_requested'
  feedback: PlanComment[]
  userNote: string | null
}

interface PendingReview {
  resolve: (d: ReviewDecision) => void
  expiresAt: number
}

const pendingReviews = new Map<string, PendingReview>()

const REVIEW_TIMEOUT_MS = 30 * 60_000

/** The referenced plan does not exist. */
class PlanNotFound extends AppError('PlanNotFound', 'NOT_FOUND')<{
  readonly planId: string
}> {}

interface PlanControllerShape {
  readonly list: (input: {
    workspaceId?: string
    kind?: PlanKind
    status?: PlanStatus
    includeNonCanonical?: boolean
  }) => Effect.Effect<Plan[]>
  readonly get: (id: string) => Effect.Effect<PlanWithMeta | null>
  readonly getBySlug: (input: { workspaceId: string; slug: string }) => Effect.Effect<PlanWithMeta | null>
  readonly create: (input: {
    workspaceId: string
    title: string
    slug?: string
    kind: PlanKind
    status?: PlanStatus
    body: string
    staleAfterDays?: number | null
    submittedByChatSessionId?: string | null
    links?: PlanLinkInput[]
    author?: PlanAuthorInput
  }) => Effect.Effect<Plan>
  readonly update: (input: {
    id: string
    expectedVersion: number
    body?: string
    title?: string
    staleAfterDays?: number | null
    summary?: string
    author?: PlanAuthorInput
  }) => Effect.Effect<Plan>
  readonly appendNote: (input: {
    id: string
    section: string
    content: string
    author?: PlanAuthorInput
  }) => Effect.Effect<Plan, PlanNotFound>
  readonly setStatus: (input: {
    id: string
    status: PlanStatus
    author?: PlanAuthorInput
  }) => Effect.Effect<Plan, PlanNotFound>
  readonly delete: (id: string) => Effect.Effect<{ deleted: boolean }>
  readonly addLink: (input: {
    planId: string
    kind: PlanLinkKind
    refId: string
    label?: string | null
  }) => Effect.Effect<PlanLink>
  readonly removeLink: (linkId: string) => Effect.Effect<{ removed: boolean }>
  readonly listLinks: (planId: string) => Effect.Effect<PlanLink[]>
  readonly listComments: (planId: string) => Effect.Effect<PlanComment[]>
  readonly addComment: (input: {
    planId: string
    body: string
    anchor?: string | null
    author?: PlanAuthorInput
    includeInFeedback?: boolean
  }) => Effect.Effect<PlanComment>
  readonly updateComment: (input: {
    commentId: string
    body?: string
    includeInFeedback?: boolean
    resolved?: boolean
  }) => Effect.Effect<PlanComment>
  readonly removeComment: (commentId: string) => Effect.Effect<{ removed: boolean }>
  readonly submitForReview: (input: {
    workspaceId: string
    title: string
    body: string
    kind: 'proposal' | 'task-plan'
    submittedByChatSessionId: string
    links?: PlanLinkInput[]
    author?: PlanAuthorInput
  }) => Effect.Effect<ReviewDecision & { planId: string }, unknown>
  readonly resolveReview: (input: {
    planId: string
    decision: 'approved' | 'changes_requested'
    userNote?: string | null
  }) => Effect.Effect<{ resolved: boolean; feedbackCount: number }>
  readonly listRevisions: (input: { planId: string; limit?: number }) => Effect.Effect<PlanRevision[]>
}

export class PlanController extends Context.Tag('PlanController')<PlanController, PlanControllerShape>() {}

export const PlanControllerLive = Layer.effect(
  PlanController,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const broadcaster = yield* Broadcaster

    return {
      list: (input) => Effect.sync(() => planRepo.listPlans(db, input)),
      get: (id) => Effect.sync(() => planRepo.getPlanWithMeta(db, id)),
      getBySlug: (input) => Effect.sync(() => planRepo.getPlanWithMetaBySlug(db, input)),
      create: (input) =>
        Effect.sync(() => {
          const author = input.author ?? { authorKind: 'user' as const, authorId: 'local' }
          const now = new Date()
          const baseSlug = input.slug ?? (slugify(input.title) || 'plan')
          const slug = planRepo.createUniqueSlug(db, input.workspaceId, baseSlug)
          const status: PlanStatus = input.status ?? (input.kind === 'prd' ? 'active' : 'draft')
          const id = uuid()
          const plan = planRepo.insertPlan(db, {
            id,
            workspaceId: input.workspaceId,
            slug,
            kind: input.kind,
            status,
            title: input.title,
            body: input.body,
            staleAfterDays: input.staleAfterDays ?? null,
            submittedByChatSessionId: input.submittedByChatSessionId ?? null,
            links: input.links,
            author,
            revisionId: uuid(),
            linkIds: input.links?.map(() => uuid()) ?? [],
            revisionSummary: 'created',
            now,
          })

          broadcaster.send('plan.created', id, input.workspaceId)
          broadcaster.send('orpc:invalidate', 'plan', 'list')

          return plan
        }),
      update: (input) =>
        Effect.sync(() => {
          const author = input.author ?? { authorKind: 'user' as const, authorId: 'local' }
          const updated = planRepo.updatePlan(db, {
            id: input.id,
            expectedVersion: input.expectedVersion,
            body: input.body,
            title: input.title,
            staleAfterDays: input.staleAfterDays,
            summary: input.summary,
            author,
            revisionId: uuid(),
            now: new Date(),
          })

          broadcaster.send('plan.updated', input.id, updated.version)
          broadcaster.send('orpc:invalidate', 'plan', 'get')

          return updated
        }),
      appendNote: (input) =>
        Effect.gen(function* () {
          const existing = planRepo.getPlan(db, input.id)
          if (!existing) return yield* new PlanNotFound({ planId: input.id, message: 'Plan not found' })

          const author = input.author ?? { authorKind: 'agent' as const, authorId: 'unknown' }
          const heading = `## ${input.section}`
          const lines = existing.body.split('\n')
          const headingIdx = lines.findIndex((l) => l.trim() === heading)
          let newBody: string

          if (headingIdx === -1) {
            const trailing = existing.body.endsWith('\n') ? '' : '\n'
            newBody = `${existing.body}${trailing}\n${heading}\n\n${input.content}\n`
          } else {
            let endIdx = lines.length
            for (let i = headingIdx + 1; i < lines.length; i++) {
              if (/^##? /.test(lines[i] ?? '')) {
                endIdx = i
                break
              }
            }
            let insertAt = endIdx
            while (insertAt > headingIdx + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--
            const before = lines.slice(0, insertAt)
            const after = lines.slice(insertAt)
            const block = ['', input.content.trimEnd(), '']
            newBody = [...before, ...block, ...after].join('\n')
          }

          const updated = planRepo.updatePlanBodyWithRevision(db, {
            id: input.id,
            body: newBody,
            author,
            revisionId: uuid(),
            summary: `appendNote(${input.section})`,
            now: new Date(),
          })

          broadcaster.send('plan.updated', input.id, updated.version)
          broadcaster.send('orpc:invalidate', 'plan', 'get')

          return updated
        }),
      setStatus: (input) =>
        Effect.gen(function* () {
          const existing = planRepo.getPlan(db, input.id)
          if (!existing) return yield* new PlanNotFound({ planId: input.id, message: 'Plan not found' })
          if (existing.status === input.status) return existing

          const author = input.author ?? { authorKind: 'user' as const, authorId: 'local' }
          const updated = planRepo.setPlanStatus(db, {
            id: input.id,
            status: input.status,
            author,
            now: new Date(),
          })

          broadcaster.send('plan.status.changed', input.id, input.status)
          broadcaster.send('orpc:invalidate', 'plan', 'get')

          return updated
        }),
      delete: (id) =>
        Effect.sync(() => {
          const result = planRepo.deletePlan(db, id)
          broadcaster.send('plan.deleted', id)
          broadcaster.send('orpc:invalidate', 'plan', 'list')
          return result
        }),
      addLink: (input) =>
        Effect.sync(() => {
          const { created, link } = planRepo.insertPlanLink(db, {
            id: uuid(),
            planId: input.planId,
            kind: input.kind,
            refId: input.refId,
            label: input.label ?? null,
            now: new Date(),
          })
          if (created) {
            broadcaster.send('plan.updated', input.planId, -1)
            broadcaster.send('orpc:invalidate', 'plan', 'get')
          }
          return link
        }),
      removeLink: (linkId) =>
        Effect.sync(() => {
          const result = planRepo.deletePlanLink(db, linkId)
          if (!result.removed) return { removed: false }
          broadcaster.send('plan.updated', result.planId, -1)
          broadcaster.send('orpc:invalidate', 'plan', 'get')
          return { removed: true }
        }),
      listLinks: (planId) => Effect.sync(() => planRepo.listPlanLinks(db, planId)),
      listComments: (planId) => Effect.sync(() => planRepo.listPlanComments(db, planId)),
      addComment: (input) =>
        Effect.sync(() => {
          const author = input.author ?? { authorKind: 'user' as const, authorId: 'local' }
          const comment = planRepo.insertPlanComment(db, {
            id: uuid(),
            planId: input.planId,
            body: input.body,
            anchor: input.anchor ?? null,
            author,
            includeInFeedback: input.includeInFeedback,
            now: new Date(),
          })

          broadcaster.send('plan.comment.added', input.planId, comment.id)
          broadcaster.send('orpc:invalidate', 'plan', 'listComments')
          return comment
        }),
      updateComment: (input) =>
        Effect.sync(() => {
          const comment = planRepo.updatePlanComment(db, {
            commentId: input.commentId,
            body: input.body,
            includeInFeedback: input.includeInFeedback,
            resolved: input.resolved,
            now: new Date(),
          })

          broadcaster.send('plan.comment.updated', comment.planId, input.commentId)
          broadcaster.send('orpc:invalidate', 'plan', 'listComments')

          return comment
        }),
      removeComment: (commentId) =>
        Effect.sync(() => {
          const result = planRepo.deletePlanComment(db, commentId)
          if (!result.removed) return { removed: false }
          broadcaster.send('plan.comment.removed', result.planId, commentId)
          broadcaster.send('orpc:invalidate', 'plan', 'listComments')
          return { removed: true }
        }),
      submitForReview: (input) =>
        Effect.gen(function* () {
          const author = input.author ?? { authorKind: 'agent' as const, authorId: input.submittedByChatSessionId }
          const now = new Date()
          const slug = planRepo.createUniqueSlug(db, input.workspaceId, slugify(input.title) || 'review')
          const planId = uuid()
          planRepo.insertPlan(db, {
            id: planId,
            workspaceId: input.workspaceId,
            slug,
            kind: input.kind,
            status: 'draft',
            title: input.title,
            body: input.body,
            staleAfterDays: null,
            submittedByChatSessionId: input.submittedByChatSessionId,
            links: input.links,
            author,
            revisionId: uuid(),
            linkIds: input.links?.map(() => uuid()) ?? [],
            lastHumanReviewAt: null,
            revisionSummary: 'submitted for review',
            now,
          })

          broadcaster.send('plan.created', planId, input.workspaceId)
          broadcaster.send('orpc:invalidate', 'plan', 'list')

          const decision = yield* Effect.promise(
            () =>
              new Promise<ReviewDecision>((resolve, reject) => {
                const expiresAt = Date.now() + REVIEW_TIMEOUT_MS
                pendingReviews.set(planId, { resolve, expiresAt })
                setTimeout(() => {
                  const entry = pendingReviews.get(planId)
                  if (entry && entry.resolve === resolve) {
                    pendingReviews.delete(planId)
                    reject(new Error('Plan review timed out — resubmit when ready.'))
                  }
                }, REVIEW_TIMEOUT_MS).unref?.()
              }),
          )

          return { ...decision, planId }
        }),
      resolveReview: (input) =>
        Effect.sync(() => {
          const { feedback, newStatus } = planRepo.resolvePlanReview(db, {
            planId: input.planId,
            decision: input.decision,
            now: new Date(),
          })

          broadcaster.send('plan.status.changed', input.planId, newStatus)
          broadcaster.send('orpc:invalidate', 'plan', 'get')

          const pending = pendingReviews.get(input.planId)
          if (pending) {
            pendingReviews.delete(input.planId)
            pending.resolve({
              decision: input.decision,
              feedback,
              userNote: input.userNote ?? null,
            })
          }

          return { resolved: pending != null, feedbackCount: feedback.length }
        }),
      listRevisions: (input) => Effect.sync(() => planRepo.listPlanRevisions(db, input)),
    }
  }),
)
