import { and, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../../../db/connection'
import { planComments, planLinks, planRevisions, plans } from '../../../db/schema'
import type {
  Plan,
  PlanAuthorKind,
  PlanComment,
  PlanKind,
  PlanLink,
  PlanLinkKind,
  PlanRevision,
  PlanStaleness,
  PlanStatus,
  PlanWithMeta,
} from '../types'

function rowToPlan(row: typeof plans.$inferSelect): Plan {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    title: row.title,
    body: row.body,
    version: row.version,
    staleAfterDays: row.staleAfterDays,
    lastHumanReviewAt: row.lastHumanReviewAt ? row.lastHumanReviewAt.getTime() : null,
    submittedByChatSessionId: row.submittedByChatSessionId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function rowToRevision(row: typeof planRevisions.$inferSelect): PlanRevision {
  return {
    id: row.id,
    planId: row.planId,
    parentRevisionId: row.parentRevisionId,
    authorKind: row.authorKind,
    authorId: row.authorId,
    body: row.body,
    summary: row.summary,
    createdAt: row.createdAt.getTime(),
  }
}

function rowToComment(row: typeof planComments.$inferSelect): PlanComment {
  return {
    id: row.id,
    planId: row.planId,
    anchor: row.anchor,
    authorKind: row.authorKind,
    authorId: row.authorId,
    body: row.body,
    includeInFeedback: row.includeInFeedback,
    resolvedAt: row.resolvedAt ? row.resolvedAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

function rowToLink(row: typeof planLinks.$inferSelect): PlanLink {
  return {
    id: row.id,
    planId: row.planId,
    kind: row.kind,
    refId: row.refId,
    label: row.label,
    createdAt: row.createdAt.getTime(),
  }
}

function deriveStaleness(row: typeof plans.$inferSelect): PlanStaleness {
  if (row.status !== 'active') {
    return { isStale: true, reason: 'inactive_status', ageDays: null }
  }
  if (row.lastHumanReviewAt == null) {
    return { isStale: true, reason: 'never_reviewed', ageDays: null }
  }
  const ageMs = Date.now() - row.lastHumanReviewAt.getTime()
  const ageDays = Math.floor(ageMs / 86_400_000)
  if (row.staleAfterDays != null && ageDays > row.staleAfterDays) {
    return { isStale: true, reason: 'past_ttl', ageDays }
  }
  return { isStale: false, reason: null, ageDays }
}

export interface PlanAuthorInput {
  authorKind: PlanAuthorKind
  authorId: string
}

export interface PlanLinkInput {
  kind: PlanLinkKind
  refId: string
  label?: string | null
}

export function createUniqueSlug(db: AppDatabase, workspaceId: string, baseSlug: string) {
  let slug = baseSlug
  let suffix = 2
  while (
    db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.workspaceId, workspaceId), eq(plans.slug, slug)))
      .get()
  ) {
    slug = `${baseSlug}-${suffix++}`
  }
  return slug
}

export function listPlans(
  db: AppDatabase,
  input: {
    workspaceId?: string
    kind?: PlanKind
    status?: PlanStatus
    includeNonCanonical?: boolean
  },
): Plan[] {
  const builder = db.select().from(plans).orderBy(desc(plans.updatedAt))
  let rows = input.workspaceId ? builder.where(eq(plans.workspaceId, input.workspaceId)).all() : builder.all()
  if (input.kind) rows = rows.filter((r) => r.kind === input.kind)
  if (input.status) rows = rows.filter((r) => r.status === input.status)
  else if (!input.includeNonCanonical) {
    rows = rows.filter((r) => r.status === 'active' || r.status === 'completed')
  }
  return rows.map(rowToPlan)
}

export function getPlan(db: AppDatabase, id: string): Plan | null {
  const row = db.select().from(plans).where(eq(plans.id, id)).get()
  return row ? rowToPlan(row) : null
}

export function getPlanWithMeta(db: AppDatabase, id: string): PlanWithMeta | null {
  const row = db.select().from(plans).where(eq(plans.id, id)).get()
  return row ? rowWithMeta(db, row) : null
}

export function getPlanWithMetaBySlug(
  db: AppDatabase,
  input: { workspaceId: string; slug: string },
): PlanWithMeta | null {
  const row = db
    .select()
    .from(plans)
    .where(and(eq(plans.workspaceId, input.workspaceId), eq(plans.slug, input.slug)))
    .get()
  return row ? rowWithMeta(db, row) : null
}

export function insertPlan(
  db: AppDatabase,
  input: {
    id: string
    workspaceId: string
    slug: string
    kind: PlanKind
    status: PlanStatus
    title: string
    body: string
    staleAfterDays?: number | null
    submittedByChatSessionId?: string | null
    links?: PlanLinkInput[]
    author: PlanAuthorInput
    revisionId: string
    linkIds: string[]
    lastHumanReviewAt?: Date | null
    revisionSummary: string
    now: Date
  },
): Plan {
  const row: typeof plans.$inferInsert = {
    id: input.id,
    workspaceId: input.workspaceId,
    slug: input.slug,
    kind: input.kind,
    status: input.status,
    title: input.title,
    body: input.body,
    version: 1,
    staleAfterDays: input.staleAfterDays ?? null,
    lastHumanReviewAt:
      input.lastHumanReviewAt !== undefined
        ? input.lastHumanReviewAt
        : input.author.authorKind === 'user'
          ? input.now
          : null,
    submittedByChatSessionId: input.submittedByChatSessionId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  }
  db.insert(plans).values(row).run()
  db.insert(planRevisions)
    .values({
      id: input.revisionId,
      planId: input.id,
      parentRevisionId: null,
      authorKind: input.author.authorKind,
      authorId: input.author.authorId,
      body: input.body,
      summary: input.revisionSummary,
      createdAt: input.now,
    })
    .run()

  input.links?.forEach((link, i) => {
    const id = input.linkIds[i]
    if (!id) throw new Error('Missing generated plan link id')
    db.insert(planLinks)
      .values({
        id,
        planId: input.id,
        kind: link.kind,
        refId: link.refId,
        label: link.label ?? null,
        createdAt: input.now,
      })
      .run()
  })

  return rowToPlan(row as typeof plans.$inferSelect)
}

export function updatePlan(
  db: AppDatabase,
  input: {
    id: string
    expectedVersion: number
    body?: string
    title?: string
    staleAfterDays?: number | null
    summary?: string
    author: PlanAuthorInput
    revisionId: string
    now: Date
  },
): Plan {
  const existing = db.select().from(plans).where(eq(plans.id, input.id)).get()
  if (!existing) throw new Error('Plan not found')
  if (existing.version !== input.expectedVersion) {
    throw new Error(`Plan version conflict (have ${existing.version}, expected ${input.expectedVersion})`)
  }

  const newVersion = existing.version + 1
  const newBody = input.body ?? existing.body
  const patch: Partial<typeof plans.$inferInsert> = {
    version: newVersion,
    updatedAt: input.now,
  }
  if (input.body !== undefined) patch.body = input.body
  if (input.title !== undefined) patch.title = input.title
  if (input.staleAfterDays !== undefined) patch.staleAfterDays = input.staleAfterDays
  if (input.author.authorKind === 'user') patch.lastHumanReviewAt = input.now

  db.update(plans).set(patch).where(eq(plans.id, input.id)).run()

  if (input.body !== undefined && input.body !== existing.body) {
    insertRevision(db, {
      id: input.revisionId,
      planId: input.id,
      author: input.author,
      body: newBody,
      summary: input.summary ?? null,
      now: input.now,
    })
  }

  return getPlan(db, input.id)!
}

export function updatePlanBodyWithRevision(
  db: AppDatabase,
  input: {
    id: string
    body: string
    author: PlanAuthorInput
    revisionId: string
    summary: string
    now: Date
  },
): Plan {
  const existing = db.select().from(plans).where(eq(plans.id, input.id)).get()
  if (!existing) throw new Error('Plan not found')

  const newVersion = existing.version + 1
  db.update(plans)
    .set({
      body: input.body,
      version: newVersion,
      updatedAt: input.now,
      ...(input.author.authorKind === 'user' ? { lastHumanReviewAt: input.now } : {}),
    })
    .where(eq(plans.id, input.id))
    .run()

  insertRevision(db, {
    id: input.revisionId,
    planId: input.id,
    author: input.author,
    body: input.body,
    summary: input.summary,
    now: input.now,
  })

  return getPlan(db, input.id)!
}

export function setPlanStatus(
  db: AppDatabase,
  input: {
    id: string
    status: PlanStatus
    author: PlanAuthorInput
    now: Date
  },
): Plan {
  const existing = db.select().from(plans).where(eq(plans.id, input.id)).get()
  if (!existing) throw new Error('Plan not found')
  if (existing.status === input.status) return rowToPlan(existing)

  const newVersion = existing.version + 1
  db.update(plans)
    .set({
      status: input.status,
      version: newVersion,
      updatedAt: input.now,
      ...(input.author.authorKind === 'user' ? { lastHumanReviewAt: input.now } : {}),
    })
    .where(eq(plans.id, input.id))
    .run()

  return getPlan(db, input.id)!
}

export function deletePlan(db: AppDatabase, id: string) {
  db.delete(plans).where(eq(plans.id, id)).run()
  return { deleted: true }
}

export function insertPlanLink(
  db: AppDatabase,
  input: {
    id: string
    planId: string
    kind: PlanLinkKind
    refId: string
    label?: string | null
    now: Date
  },
): { link: PlanLink; created: boolean } {
  const existing = db
    .select()
    .from(planLinks)
    .where(and(eq(planLinks.planId, input.planId), eq(planLinks.kind, input.kind), eq(planLinks.refId, input.refId)))
    .get()
  if (existing) return { link: rowToLink(existing), created: false }

  const row: typeof planLinks.$inferInsert = {
    id: input.id,
    planId: input.planId,
    kind: input.kind,
    refId: input.refId,
    label: input.label ?? null,
    createdAt: input.now,
  }
  db.insert(planLinks).values(row).run()
  return { link: rowToLink(row as typeof planLinks.$inferSelect), created: true }
}

export function deletePlanLink(db: AppDatabase, linkId: string) {
  const row = db.select().from(planLinks).where(eq(planLinks.id, linkId)).get()
  if (!row) return { removed: false, planId: null }
  db.delete(planLinks).where(eq(planLinks.id, linkId)).run()
  return { removed: true, planId: row.planId }
}

export function listPlanLinks(db: AppDatabase, planId: string): PlanLink[] {
  return db
    .select()
    .from(planLinks)
    .where(eq(planLinks.planId, planId))
    .orderBy(planLinks.createdAt)
    .all()
    .map(rowToLink)
}

export function listPlanComments(db: AppDatabase, planId: string): PlanComment[] {
  return db
    .select()
    .from(planComments)
    .where(eq(planComments.planId, planId))
    .orderBy(planComments.createdAt)
    .all()
    .map(rowToComment)
}

export function insertPlanComment(
  db: AppDatabase,
  input: {
    id: string
    planId: string
    body: string
    anchor?: string | null
    author: PlanAuthorInput
    includeInFeedback?: boolean
    now: Date
  },
): PlanComment {
  const plan = db.select().from(plans).where(eq(plans.id, input.planId)).get()
  if (!plan) throw new Error('Plan not found')

  const defaultInclude = plan.submittedByChatSessionId != null
  const row: typeof planComments.$inferInsert = {
    id: input.id,
    planId: input.planId,
    anchor: input.anchor ?? null,
    authorKind: input.author.authorKind,
    authorId: input.author.authorId,
    body: input.body,
    includeInFeedback: input.includeInFeedback ?? defaultInclude,
    resolvedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
  db.insert(planComments).values(row).run()
  db.update(plans).set({ updatedAt: input.now }).where(eq(plans.id, input.planId)).run()

  return rowToComment(row as typeof planComments.$inferSelect)
}

export function updatePlanComment(
  db: AppDatabase,
  input: {
    commentId: string
    body?: string
    includeInFeedback?: boolean
    resolved?: boolean
    now: Date
  },
): PlanComment {
  const existing = db.select().from(planComments).where(eq(planComments.id, input.commentId)).get()
  if (!existing) throw new Error('Comment not found')

  const patch: Partial<typeof planComments.$inferInsert> = { updatedAt: input.now }
  if (input.body !== undefined) patch.body = input.body
  if (input.includeInFeedback !== undefined) patch.includeInFeedback = input.includeInFeedback
  if (input.resolved !== undefined) patch.resolvedAt = input.resolved ? input.now : null

  db.update(planComments).set(patch).where(eq(planComments.id, input.commentId)).run()

  const updated = db.select().from(planComments).where(eq(planComments.id, input.commentId)).get()!
  return rowToComment(updated)
}

export function deletePlanComment(db: AppDatabase, commentId: string) {
  const existing = db.select().from(planComments).where(eq(planComments.id, commentId)).get()
  if (!existing) return { removed: false, planId: null }
  db.delete(planComments).where(eq(planComments.id, commentId)).run()
  return { removed: true, planId: existing.planId }
}

export function resolvePlanReview(
  db: AppDatabase,
  input: {
    planId: string
    decision: 'approved' | 'changes_requested'
    now: Date
  },
) {
  const plan = db.select().from(plans).where(eq(plans.id, input.planId)).get()
  if (!plan) throw new Error('Plan not found')

  const feedback = db
    .select()
    .from(planComments)
    .where(eq(planComments.planId, input.planId))
    .orderBy(planComments.createdAt)
    .all()
    .filter((comment) => comment.includeInFeedback && comment.resolvedAt == null)
    .map(rowToComment)

  const newStatus: PlanStatus = input.decision === 'approved' ? 'active' : 'draft'
  const newVersion = plan.version + 1
  db.update(plans)
    .set({
      status: newStatus,
      version: newVersion,
      lastHumanReviewAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(plans.id, input.planId))
    .run()

  return { newStatus, feedback }
}

export function listPlanRevisions(
  db: AppDatabase,
  input: {
    planId: string
    limit?: number
  },
): PlanRevision[] {
  return db
    .select()
    .from(planRevisions)
    .where(eq(planRevisions.planId, input.planId))
    .orderBy(desc(planRevisions.createdAt))
    .limit(input.limit ?? 50)
    .all()
    .map(rowToRevision)
}

function rowWithMeta(db: AppDatabase, row: typeof plans.$inferSelect): PlanWithMeta {
  return {
    ...rowToPlan(row),
    staleness: deriveStaleness(row),
    links: listPlanLinks(db, row.id),
  }
}

function insertRevision(
  db: AppDatabase,
  input: {
    id: string
    planId: string
    author: PlanAuthorInput
    body: string
    summary: string | null
    now: Date
  },
) {
  const parent = db
    .select({ id: planRevisions.id })
    .from(planRevisions)
    .where(eq(planRevisions.planId, input.planId))
    .orderBy(desc(planRevisions.createdAt))
    .get()
  db.insert(planRevisions)
    .values({
      id: input.id,
      planId: input.planId,
      parentRevisionId: parent?.id ?? null,
      authorKind: input.author.authorKind,
      authorId: input.author.authorId,
      body: input.body,
      summary: input.summary,
      createdAt: input.now,
    })
    .run()
}
