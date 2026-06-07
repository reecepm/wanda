import { ORPCError } from '@orpc/client'
import { Effect } from 'effect'
import { z } from 'zod'
import { TaskStoreService } from '../../domains/tasks'
import type { AppRouterDeps } from '../index'

/** Wrap a TaskStore promise, mapping thrown errors to ORPCError */
function wrap<A>(
  fn: () => Promise<A>,
): Effect.Effect<A, ORPCError<'INTERNAL_SERVER_ERROR', undefined>, TaskStoreService> {
  return Effect.tryPromise({
    try: fn,
    catch: (err) =>
      new ORPCError('INTERNAL_SERVER_ERROR', {
        message: err instanceof Error ? err.message : String(err),
        cause: err,
      }),
  })
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const taskFilterSchema = z
  .object({
    projectId: z.string().optional(),
    parentId: z.string().nullable().optional(),
    status: z.array(z.enum(['draft', 'pending', 'ready', 'in_progress', 'blocked', 'completed', 'failed'])).optional(),
    type: z.array(z.enum(['milestone', 'epic', 'task', 'subtask'])).optional(),
    assignable: z.array(z.enum(['human', 'agent', 'either'])).optional(),
    origin: z.array(z.enum(['human', 'agent'])).optional(),
    claimedBy: z.string().optional(),
    ids: z.array(z.string()).optional(),
    archived: z.boolean().optional(),
    source: z.string().optional(),
  })
  .optional()

const projectConfigSchema = z
  .object({
    autoClaimSubtasks: z.boolean().optional(),
    requireReview: z.boolean().optional(),
    allowedAgentTags: z.array(z.string()).optional(),
    maxConcurrentTasks: z.number().optional(),
    defaultLeaseTtl: z.number().optional(),
    schedulingStrategy: z.enum(['priority', 'fifo']).optional(),
    autoBlockOnContextRequest: z.boolean().optional(),
  })
  .optional()

const workspaceConfigSchema = z
  .object({
    allowedAgentTags: z.array(z.string()).optional(),
    maxProjects: z.number().optional(),
    defaultLeaseTtl: z.number().optional(),
  })
  .optional()

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function taskRoutes({ effectOs }: AppRouterDeps) {
  return {
    // ── Tasks ──────────────────────────────────────────────────────────

    list: effectOs.input(taskFilterSchema).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.tasks.list(input ?? undefined))
    }),

    get: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      const task = yield* wrap(() => store.tasks.get(input.id))
      if (!task) throw new ORPCError('NOT_FOUND', { message: `Task ${input.id} not found` })
      return task
    }),

    /** Resolve a task by raw ID or short identifier (e.g. "TSK-42"). */
    resolve: effectOs.input(z.object({ ref: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      const task = yield* wrap(() => store.tasks.resolve(input.ref))
      if (!task) throw new ORPCError('NOT_FOUND', { message: `Task not found: ${input.ref}` })
      return task
    }),

    create: effectOs
      .input(
        z.object({
          title: z.string(),
          projectId: z.string().nullable().optional(),
          parentId: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
          content: z.string().nullable().optional(),
          type: z.enum(['milestone', 'epic', 'task', 'subtask']).optional(),
          status: z.enum(['draft', 'ready']).optional(),
          origin: z.enum(['human', 'agent']).optional(),
          assignable: z.enum(['human', 'agent', 'either']).optional(),
          priority: z.number().optional(),
          labels: z.record(z.string(), z.string()).optional(),
          dependsOn: z.array(z.string()).optional(),
          context: z.string().nullable().optional(),
          createdBy: z.string().nullable().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.create(input))
      }),

    update: effectOs
      .input(
        z.object({
          id: z.string(),
          expectedVersion: z.number(),
          title: z.string().optional(),
          description: z.string().nullable().optional(),
          content: z.string().nullable().optional(),
          type: z.enum(['milestone', 'epic', 'task', 'subtask']).optional(),
          status: z.enum(['draft', 'pending', 'ready', 'in_progress', 'blocked', 'completed', 'failed']).optional(),
          assignable: z.enum(['human', 'agent', 'either']).optional(),
          priority: z.number().optional(),
          labels: z.record(z.string(), z.string()).optional(),
          dependsOn: z.array(z.string()).optional(),
          context: z.string().nullable().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        const { id, expectedVersion, ...updates } = input
        return yield* wrap(() => store.tasks.update(id, updates, expectedVersion))
      }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      yield* wrap(() => store.tasks.delete(input.id))
    }),

    publish: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.tasks.publish(input.id))
    }),

    claim: effectOs
      .input(
        z.object({
          id: z.string(),
          agentId: z.string(),
          leaseTtl: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.claim(input.id, input.agentId, { leaseTtl: input.leaseTtl }))
      }),

    complete: effectOs
      .input(
        z.object({
          id: z.string(),
          output: z.string().optional(),
          data: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        const result = input.output || input.data ? { output: input.output, data: input.data } : undefined
        return yield* wrap(() => store.tasks.complete(input.id, result))
      }),

    fail: effectOs
      .input(
        z.object({
          id: z.string(),
          reason: z.string(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.fail(input.id, input.reason))
      }),

    block: effectOs
      .input(
        z.object({
          id: z.string(),
          reason: z.string(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.block(input.id, input.reason))
      }),

    unblock: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.tasks.unblock(input.id))
    }),

    release: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.tasks.release(input.id))
    }),

    renew: effectOs
      .input(
        z.object({
          id: z.string(),
          ttl: z.number().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.renew(input.id, { ttl: input.ttl }))
      }),

    nextReady: effectOs
      .input(
        z
          .object({
            projectId: z.string().optional(),
            assignable: z.enum(['human', 'agent', 'either']).optional(),
            agentTags: z.array(z.string()).optional(),
          })
          .optional(),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.tasks.nextReady(input ?? undefined))
      }),

    getTree: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.tasks.getTree(input.id))
    }),

    // ── Projects ───────────────────────────────────────────────────────

    listProjects: effectOs
      .input(
        z
          .object({
            workspaceId: z.string().optional(),
            archived: z.boolean().optional(),
          })
          .optional(),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.projects.list(input ?? undefined))
      }),

    getProject: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      const project = yield* wrap(() => store.projects.get(input.id))
      if (!project) throw new ORPCError('NOT_FOUND', { message: `Project ${input.id} not found` })
      return project
    }),

    createProject: effectOs
      .input(
        z.object({
          name: z.string(),
          workspaceId: z.string(),
          identifier: z.string().min(1).max(12),
          description: z.string().nullable().optional(),
          config: projectConfigSchema,
          labels: z.record(z.string(), z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.projects.create(input))
      }),

    updateProject: effectOs
      .input(
        z.object({
          id: z.string(),
          expectedVersion: z.number(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          config: projectConfigSchema,
          labels: z.record(z.string(), z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        const { id, expectedVersion, ...updates } = input
        return yield* wrap(() => store.projects.update(id, updates, expectedVersion))
      }),

    archiveProject: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      yield* wrap(() => store.projects.archive(input.id))
    }),

    // ── Workspaces ─────────────────────────────────────────────────────

    listWorkspaces: effectOs.effect(function* () {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.workspaces.list())
    }),

    getWorkspace: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      const workspace = yield* wrap(() => store.workspaces.get(input.id))
      if (!workspace) throw new ORPCError('NOT_FOUND', { message: `Workspace ${input.id} not found` })
      return workspace
    }),

    createWorkspace: effectOs
      .input(
        z.object({
          name: z.string(),
          description: z.string().nullable().optional(),
          config: workspaceConfigSchema,
          labels: z.record(z.string(), z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.workspaces.create(input))
      }),

    updateWorkspace: effectOs
      .input(
        z.object({
          id: z.string(),
          expectedVersion: z.number(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          config: workspaceConfigSchema,
          labels: z.record(z.string(), z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        const { id, expectedVersion, ...updates } = input
        return yield* wrap(() => store.workspaces.update(id, updates, expectedVersion))
      }),

    archiveWorkspace: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      yield* wrap(() => store.workspaces.archive(input.id))
    }),

    // ── Learnings ──────────────────────────────────────────────────────

    addLearning: effectOs
      .input(
        z.object({
          taskId: z.string(),
          content: z.string(),
          sourceTaskId: z.string().optional(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.learnings.add(input.taskId, input.content, input.sourceTaskId))
      }),

    listLearnings: effectOs.input(z.object({ taskId: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.learnings.list(input.taskId))
    }),

    // ── Context ────────────────────────────────────────────────────────

    requestContext: effectOs
      .input(
        z.object({
          taskId: z.string(),
          agentId: z.string(),
          question: z.string(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.context.request(input.taskId, input.agentId, input.question))
      }),

    answerContext: effectOs
      .input(
        z.object({
          requestId: z.string(),
          respondedBy: z.string(),
          response: z.string(),
        }),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.context.answer(input.requestId, input.respondedBy, input.response))
      }),

    listContextByTask: effectOs.input(z.object({ taskId: z.string() })).effect(function* ({ input }) {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.context.listByTask(input.taskId))
    }),

    pendingContext: effectOs.effect(function* () {
      const store = yield* TaskStoreService
      return yield* wrap(() => store.context.pending())
    }),

    // ── Peers ──────────────────────────────────────────────────────────

    peerStatus: effectOs.effect(function* () {
      const store = yield* TaskStoreService
      return store.peers.status()
    }),

    // ── Events ─────────────────────────────────────────────────────────

    listEvents: effectOs
      .input(
        z
          .object({
            after: z.number().optional(),
            limit: z.number().optional(),
            types: z.array(z.string()).optional(),
          })
          .optional(),
      )
      .effect(function* ({ input }) {
        const store = yield* TaskStoreService
        return yield* wrap(() => store.events.list(input ?? undefined))
      }),

    // ── Tick (manual trigger) ──────────────────────────────────────────

    tick: effectOs.effect(function* () {
      const store = yield* TaskStoreService
      yield* wrap(() => store.tick())
    }),
  }
}
