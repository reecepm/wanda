import { z } from 'zod'
import { PlanController } from '../../services'
import type { AppRouterDeps } from '../index'

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const planKindSchema = z.enum(['prd', 'task-plan', 'proposal'])
const planStatusSchema = z.enum(['draft', 'active', 'completed', 'archived', 'superseded'])
const authorKindSchema = z.enum(['user', 'agent'])
const linkKindSchema = z.enum(['workenv', 'pod', 'chatSession', 'branch'])

const authorSchema = z.object({
  authorKind: authorKindSchema.default('user'),
  authorId: z.string().min(1).default('local'),
})

export function planRoutes({ effectOs }: AppRouterDeps) {
  return {
    list: effectOs
      .input(
        z.object({
          /** When omitted, returns plans across all workspaces. */
          workspaceId: z.string().optional(),
          kind: planKindSchema.optional(),
          status: planStatusSchema.optional(),
          /** When true, includes drafts/superseded/archived. Default excludes them. */
          includeNonCanonical: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.list(input)
      }),

    /**
     * Returns the plan body, metadata, staleness verdict, and links in one
     * shot. This is the canonical agent read — every reply must surface the
     * staleness signal so future agents don't act on outdated specs.
     */
    get: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.get(input.id)
    }),

    getBySlug: effectOs.input(z.object({ workspaceId: z.string(), slug: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.getBySlug(input)
    }),

    create: effectOs
      .input(
        z.object({
          workspaceId: z.string(),
          title: z.string().min(1).max(200),
          slug: z.string().regex(SLUG_RE).optional(),
          kind: planKindSchema.default('prd'),
          status: planStatusSchema.optional(),
          body: z.string().default(''),
          staleAfterDays: z.number().int().positive().nullish(),
          submittedByChatSessionId: z.string().nullish(),
          links: z.array(z.object({ kind: linkKindSchema, refId: z.string(), label: z.string().nullish() })).optional(),
          author: authorSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.create(input)
      }),

    /**
     * Whole-document body / metadata replace with optimistic locking. Returns
     * the updated plan; throws when `expectedVersion` doesn't match the
     * current row (caller must re-read and reapply).
     */
    update: effectOs
      .input(
        z.object({
          id: z.string(),
          expectedVersion: z.number().int().positive(),
          body: z.string().optional(),
          title: z.string().min(1).max(200).optional(),
          staleAfterDays: z.number().int().positive().nullish(),
          summary: z.string().max(500).optional(),
          author: authorSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.update(input)
      }),

    /**
     * Append a markdown note under the named heading. Server-side merge —
     * never conflicts with concurrent user edits because it targets an
     * append-only region.
     */
    appendNote: effectOs
      .input(
        z.object({
          id: z.string(),
          section: z.string().min(1).max(100),
          content: z.string().min(1),
          author: authorSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.appendNote(input)
      }),

    setStatus: effectOs
      .input(
        z.object({
          id: z.string(),
          status: planStatusSchema,
          author: authorSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.setStatus(input)
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.delete(input.id)
    }),

    addLink: effectOs
      .input(
        z.object({
          planId: z.string(),
          kind: linkKindSchema,
          refId: z.string().min(1),
          label: z.string().nullish(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.addLink(input)
      }),

    removeLink: effectOs.input(z.object({ linkId: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.removeLink(input.linkId)
    }),

    listLinks: effectOs.input(z.object({ planId: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.listLinks(input.planId)
    }),

    listComments: effectOs.input(z.object({ planId: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.listComments(input.planId)
    }),

    addComment: effectOs
      .input(
        z.object({
          planId: z.string(),
          body: z.string().min(1),
          anchor: z.string().nullish(),
          author: authorSchema.optional(),
          /** Override the per-plan default. Usually omitted. */
          includeInFeedback: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.addComment(input)
      }),

    updateComment: effectOs
      .input(
        z.object({
          commentId: z.string(),
          body: z.string().min(1).optional(),
          includeInFeedback: z.boolean().optional(),
          resolved: z.boolean().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.updateComment(input)
      }),

    removeComment: effectOs.input(z.object({ commentId: z.string() })).effect(function* ({ input }) {
      const planSvc = yield* PlanController
      return yield* planSvc.removeComment(input.commentId)
    }),

    /**
     * Agent-submitted plan-review. Creates a draft plan tied to the calling
     * chat session and blocks until the user approves or requests changes.
     */
    submitForReview: effectOs
      .input(
        z.object({
          workspaceId: z.string(),
          title: z.string().min(1).max(200),
          body: z.string().default(''),
          kind: z.enum(['proposal', 'task-plan']).default('proposal'),
          submittedByChatSessionId: z.string().min(1),
          links: z.array(z.object({ kind: linkKindSchema, refId: z.string(), label: z.string().nullish() })).optional(),
          author: authorSchema.optional(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.submitForReview(input)
      }),

    /**
     * UI-side resolution. Called when the user clicks Approve or Request
     * changes. Bundles the included, unresolved comments and resolves the
     * pending agent call.
     */
    resolveReview: effectOs
      .input(
        z.object({
          planId: z.string(),
          decision: z.enum(['approved', 'changes_requested']),
          userNote: z.string().nullish(),
        }),
      )
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.resolveReview(input)
      }),

    listRevisions: effectOs
      .input(z.object({ planId: z.string(), limit: z.number().int().positive().max(200).optional() }))
      .effect(function* ({ input }) {
        const planSvc = yield* PlanController
        return yield* planSvc.listRevisions(input)
      }),
  }
}

export type {
  PlanComment,
  PlanKind,
  PlanLink,
  PlanLinkKind,
  PlanRevision,
  PlanStatus,
} from '../../domains/plan/types'
