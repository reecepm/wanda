import { and, desc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../../db/connection'

type TaskDb = AppDatabase

import type {
  ContextRequest,
  ContextRequestStorage,
  EventStorage,
  Learning,
  LearningStorage,
  Project,
  ProjectFilter,
  ProjectStorage,
  StorageAdapter,
  Task,
  TaskEvent,
  TaskFilter,
  TaskStorage,
  Workspace,
  WorkspaceStorage,
} from '@wanda/tasks'
import { VersionConflictError } from '@wanda/tasks'
import {
  taskContextRequests,
  taskEvents,
  taskLearnings,
  taskProjects,
  tasks,
  taskWorkspaces,
} from '../../db/task-schema'

// ---------------------------------------------------------------------------
// Row ↔ Domain helpers
// ---------------------------------------------------------------------------

// Drizzle's `mode: 'timestamp_ms'` stores/returns Date objects, but
// @wanda/tasks uses plain epoch-ms numbers. These helpers bridge the gap.

function dateToMs(d: Date): number {
  return d.getTime()
}

function msToDate(ms: number): Date {
  return new Date(ms)
}

function dateOrNull(d: Date | null): number | null {
  return d ? d.getTime() : null
}

function msOrNull(ms: number | null): Date | null {
  return ms != null ? new Date(ms) : null
}

// ---------------------------------------------------------------------------
// Task row mapping
// ---------------------------------------------------------------------------

type TaskRow = typeof tasks.$inferSelect

function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    sequenceId: row.sequenceId,
    parentId: row.parentId,
    title: row.title,
    description: row.description,
    content: row.content,
    type: row.type,
    status: row.status,
    origin: row.origin,
    assignable: row.assignable,
    priority: row.priority,
    labels: row.labels,
    dependsOn: row.dependsOn,
    claimedBy: row.claimedBy,
    claimedAt: dateOrNull(row.claimedAt),
    leaseExpiresAt: dateOrNull(row.leaseExpiresAt),
    context: row.context,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: dateToMs(row.createdAt),
    updatedAt: dateToMs(row.updatedAt),
    completedAt: dateOrNull(row.completedAt),
    archivedAt: dateOrNull(row.archivedAt),
  }
}

function taskToRow(task: Task): typeof tasks.$inferInsert {
  return {
    id: task.id,
    projectId: task.projectId,
    sequenceId: task.sequenceId,
    parentId: task.parentId,
    title: task.title,
    description: task.description,
    content: task.content,
    type: task.type,
    status: task.status,
    origin: task.origin,
    assignable: task.assignable,
    priority: task.priority,
    labels: task.labels,
    dependsOn: task.dependsOn,
    claimedBy: task.claimedBy,
    claimedAt: msOrNull(task.claimedAt),
    leaseExpiresAt: msOrNull(task.leaseExpiresAt),
    context: task.context,
    version: task.version,
    createdBy: task.createdBy,
    createdAt: msToDate(task.createdAt),
    updatedAt: msToDate(task.updatedAt),
    completedAt: msOrNull(task.completedAt),
    archivedAt: msOrNull(task.archivedAt),
  }
}

// ---------------------------------------------------------------------------
// Project row mapping
// ---------------------------------------------------------------------------

type ProjectRow = typeof taskProjects.$inferSelect

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    identifier: row.identifier,
    description: row.description,
    sequenceCounter: row.sequenceCounter,
    config: row.config,
    labels: row.labels,
    metadata: row.metadata,
    version: row.version,
    createdAt: dateToMs(row.createdAt),
    updatedAt: dateToMs(row.updatedAt),
    archivedAt: dateOrNull(row.archivedAt),
  }
}

function projectToRow(project: Project): typeof taskProjects.$inferInsert {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    identifier: project.identifier,
    description: project.description,
    sequenceCounter: project.sequenceCounter,
    config: project.config,
    labels: project.labels,
    metadata: project.metadata,
    version: project.version,
    createdAt: msToDate(project.createdAt),
    updatedAt: msToDate(project.updatedAt),
    archivedAt: msOrNull(project.archivedAt),
  }
}

// ---------------------------------------------------------------------------
// Workspace row mapping
// ---------------------------------------------------------------------------

type WorkspaceRow = typeof taskWorkspaces.$inferSelect

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: row.config,
    labels: row.labels,
    metadata: row.metadata,
    version: row.version,
    createdAt: dateToMs(row.createdAt),
    updatedAt: dateToMs(row.updatedAt),
    archivedAt: dateOrNull(row.archivedAt),
  }
}

function workspaceToRow(workspace: Workspace): typeof taskWorkspaces.$inferInsert {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    config: workspace.config,
    labels: workspace.labels,
    metadata: workspace.metadata,
    version: workspace.version,
    createdAt: msToDate(workspace.createdAt),
    updatedAt: msToDate(workspace.updatedAt),
    archivedAt: msOrNull(workspace.archivedAt),
  }
}

// ---------------------------------------------------------------------------
// Event row mapping
// ---------------------------------------------------------------------------

type EventRow = typeof taskEvents.$inferSelect

function eventFromRow(row: EventRow): TaskEvent {
  return {
    id: row.id,
    position: row.position,
    type: row.type as TaskEvent['type'],
    entityId: row.entityId ?? '',
    agentId: row.agentId,
    data: row.data,
    timestamp: dateToMs(row.timestamp),
    instanceId: row.instanceId,
  }
}

function eventToRow(event: TaskEvent): typeof taskEvents.$inferInsert {
  return {
    id: event.id,
    position: event.position,
    type: event.type,
    entityId: event.entityId,
    agentId: event.agentId,
    data: event.data,
    timestamp: msToDate(event.timestamp),
    instanceId: event.instanceId,
  }
}

// ---------------------------------------------------------------------------
// Learning row mapping
// ---------------------------------------------------------------------------

type LearningRow = typeof taskLearnings.$inferSelect

function learningFromRow(row: LearningRow): Learning {
  return {
    id: row.id,
    taskId: row.taskId,
    sourceTaskId: row.sourceTaskId,
    content: row.content,
    createdAt: dateToMs(row.createdAt),
  }
}

function learningToRow(learning: Learning): typeof taskLearnings.$inferInsert {
  return {
    id: learning.id,
    taskId: learning.taskId,
    sourceTaskId: learning.sourceTaskId,
    content: learning.content,
    createdAt: msToDate(learning.createdAt),
  }
}

// ---------------------------------------------------------------------------
// ContextRequest row mapping
// ---------------------------------------------------------------------------

type ContextRequestRow = typeof taskContextRequests.$inferSelect

function contextRequestFromRow(row: ContextRequestRow): ContextRequest {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    question: row.question,
    response: row.response,
    status: row.status,
    autoBlocked: row.autoBlocked,
    createdAt: dateToMs(row.createdAt),
    respondedAt: dateOrNull(row.respondedAt),
    respondedBy: row.respondedBy,
  }
}

function contextRequestToRow(request: ContextRequest): typeof taskContextRequests.$inferInsert {
  return {
    id: request.id,
    taskId: request.taskId,
    agentId: request.agentId,
    question: request.question,
    response: request.response,
    status: request.status,
    autoBlocked: request.autoBlocked,
    createdAt: msToDate(request.createdAt),
    respondedAt: msOrNull(request.respondedAt),
    respondedBy: request.respondedBy,
  }
}

// ---------------------------------------------------------------------------
// Storage implementations
// ---------------------------------------------------------------------------

class DrizzleTaskStorage implements TaskStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async insert(task: Task): Promise<void> {
    this.db.insert(tasks).values(taskToRow(task)).run()
  }

  async get(id: string): Promise<Task | null> {
    const row = this.db.select().from(tasks).where(eq(tasks.id, id)).get()
    return row ? taskFromRow(row) : null
  }

  async getMany(ids: string[]): Promise<Task[]> {
    if (ids.length === 0) return []
    const rows = this.db.select().from(tasks).where(inArray(tasks.id, ids)).all()
    return rows.map(taskFromRow)
  }

  async list(filter: TaskFilter): Promise<Task[]> {
    const conditions = []

    if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId))
    if (filter.parentId !== undefined) {
      conditions.push(filter.parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, filter.parentId))
    }
    if (filter.status) conditions.push(inArray(tasks.status, filter.status))
    if (filter.type) conditions.push(inArray(tasks.type, filter.type))
    if (filter.assignable) conditions.push(inArray(tasks.assignable, filter.assignable))
    if (filter.origin) conditions.push(inArray(tasks.origin, filter.origin))
    if (filter.claimedBy) conditions.push(eq(tasks.claimedBy, filter.claimedBy))
    if (filter.ids) conditions.push(inArray(tasks.id, filter.ids))
    if (filter.archived === false) conditions.push(isNull(tasks.archivedAt))
    if (filter.archived === true) conditions.push(isNotNull(tasks.archivedAt))

    const query = this.db.select().from(tasks)
    const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all()

    return rows.map(taskFromRow)
  }

  async update(id: string, patch: Partial<Task>, expectedVersion: number): Promise<Task> {
    const setValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (
        key === 'createdAt' ||
        key === 'updatedAt' ||
        key === 'completedAt' ||
        key === 'archivedAt' ||
        key === 'claimedAt' ||
        key === 'leaseExpiresAt'
      ) {
        setValues[key] = msOrNull(value as number | null)
      } else {
        setValues[key] = value
      }
    }

    const result = this.db
      .update(tasks)
      .set(setValues)
      .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
      .run()

    if (result.changes === 0) {
      // Either not found or version mismatch — check which
      const existing = this.db.select().from(tasks).where(eq(tasks.id, id)).get()
      if (!existing) throw new Error(`Task ${id} not found in storage`)
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }

    const updated = this.db.select().from(tasks).where(eq(tasks.id, id)).get()!
    return taskFromRow(updated)
  }

  async delete(id: string): Promise<void> {
    this.db.delete(tasks).where(eq(tasks.id, id)).run()
  }
}

class DrizzleProjectStorage implements ProjectStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async insert(project: Project): Promise<void> {
    this.db.insert(taskProjects).values(projectToRow(project)).run()
  }

  async get(id: string): Promise<Project | null> {
    const row = this.db.select().from(taskProjects).where(eq(taskProjects.id, id)).get()
    return row ? projectFromRow(row) : null
  }

  async list(filter: ProjectFilter): Promise<Project[]> {
    const conditions = []
    if (filter.workspaceId) conditions.push(eq(taskProjects.workspaceId, filter.workspaceId))
    if (filter.archived === false) conditions.push(isNull(taskProjects.archivedAt))
    if (filter.archived === true) conditions.push(isNotNull(taskProjects.archivedAt))

    const query = this.db.select().from(taskProjects)
    const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all()

    return rows.map(projectFromRow)
  }

  async update(id: string, patch: Partial<Project>, expectedVersion: number): Promise<Project> {
    const setValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'createdAt' || key === 'updatedAt' || key === 'archivedAt') {
        setValues[key] = msOrNull(value as number | null)
      } else {
        setValues[key] = value
      }
    }

    const result = this.db
      .update(taskProjects)
      .set(setValues)
      .where(and(eq(taskProjects.id, id), eq(taskProjects.version, expectedVersion)))
      .run()

    if (result.changes === 0) {
      const existing = this.db.select().from(taskProjects).where(eq(taskProjects.id, id)).get()
      if (!existing) throw new Error(`Project ${id} not found in storage`)
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }

    const updated = this.db.select().from(taskProjects).where(eq(taskProjects.id, id)).get()!
    return projectFromRow(updated)
  }

  async delete(id: string): Promise<void> {
    this.db.delete(taskProjects).where(eq(taskProjects.id, id)).run()
  }
}

class DrizzleWorkspaceStorage implements WorkspaceStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async insert(workspace: Workspace): Promise<void> {
    this.db.insert(taskWorkspaces).values(workspaceToRow(workspace)).run()
  }

  async get(id: string): Promise<Workspace | null> {
    const row = this.db.select().from(taskWorkspaces).where(eq(taskWorkspaces.id, id)).get()
    return row ? workspaceFromRow(row) : null
  }

  async list(): Promise<Workspace[]> {
    const rows = this.db.select().from(taskWorkspaces).all()
    return rows.map(workspaceFromRow)
  }

  async update(id: string, patch: Partial<Workspace>, expectedVersion: number): Promise<Workspace> {
    const setValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'createdAt' || key === 'updatedAt' || key === 'archivedAt') {
        setValues[key] = msOrNull(value as number | null)
      } else {
        setValues[key] = value
      }
    }

    const result = this.db
      .update(taskWorkspaces)
      .set(setValues)
      .where(and(eq(taskWorkspaces.id, id), eq(taskWorkspaces.version, expectedVersion)))
      .run()

    if (result.changes === 0) {
      const existing = this.db.select().from(taskWorkspaces).where(eq(taskWorkspaces.id, id)).get()
      if (!existing) throw new Error(`Workspace ${id} not found in storage`)
      throw new VersionConflictError(id, expectedVersion, existing.version)
    }

    const updated = this.db.select().from(taskWorkspaces).where(eq(taskWorkspaces.id, id)).get()!
    return workspaceFromRow(updated)
  }

  async delete(id: string): Promise<void> {
    this.db.delete(taskWorkspaces).where(eq(taskWorkspaces.id, id)).run()
  }
}

class DrizzleEventStorage implements EventStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async append(event: TaskEvent): Promise<void> {
    this.db.insert(taskEvents).values(eventToRow(event)).run()
  }

  async list(opts: { after?: number; limit?: number; types?: string[] }): Promise<TaskEvent[]> {
    const conditions = []
    if (opts.after != null) conditions.push(gt(taskEvents.position, opts.after))
    if (opts.types) conditions.push(inArray(taskEvents.type, opts.types))

    let query = this.db.select().from(taskEvents)

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query
    }

    const rows = query
      .orderBy(taskEvents.position)
      .limit(opts.limit ?? 1000)
      .all()

    return rows.map(eventFromRow)
  }

  async lastPosition(): Promise<number> {
    const row = this.db
      .select({ position: taskEvents.position })
      .from(taskEvents)
      .orderBy(desc(taskEvents.position))
      .limit(1)
      .get()
    return row?.position ?? 0
  }
}

class DrizzleLearningStorage implements LearningStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async insert(learning: Learning): Promise<void> {
    this.db.insert(taskLearnings).values(learningToRow(learning)).run()
  }

  async list(taskId: string): Promise<Learning[]> {
    const rows = this.db.select().from(taskLearnings).where(eq(taskLearnings.taskId, taskId)).all()
    return rows.map(learningFromRow)
  }
}

class DrizzleContextRequestStorage implements ContextRequestStorage {
  db: TaskDb
  constructor(db: TaskDb) {
    this.db = db
  }

  async insert(request: ContextRequest): Promise<void> {
    this.db.insert(taskContextRequests).values(contextRequestToRow(request)).run()
  }

  async get(id: string): Promise<ContextRequest | null> {
    const row = this.db.select().from(taskContextRequests).where(eq(taskContextRequests.id, id)).get()
    return row ? contextRequestFromRow(row) : null
  }

  async update(id: string, patch: Partial<ContextRequest>): Promise<ContextRequest> {
    const setValues: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'createdAt' || key === 'respondedAt') {
        setValues[key] = msOrNull(value as number | null)
      } else {
        setValues[key] = value
      }
    }

    const result = this.db.update(taskContextRequests).set(setValues).where(eq(taskContextRequests.id, id)).run()

    if (result.changes === 0) {
      throw new Error(`ContextRequest ${id} not found in storage`)
    }

    const updated = this.db.select().from(taskContextRequests).where(eq(taskContextRequests.id, id)).get()!
    return contextRequestFromRow(updated)
  }

  async listByTask(taskId: string): Promise<ContextRequest[]> {
    const rows = this.db.select().from(taskContextRequests).where(eq(taskContextRequests.taskId, taskId)).all()
    return rows.map(contextRequestFromRow)
  }

  async listPending(): Promise<ContextRequest[]> {
    const rows = this.db.select().from(taskContextRequests).where(eq(taskContextRequests.status, 'pending')).all()
    return rows.map(contextRequestFromRow)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDrizzleStorageAdapter(db: TaskDb): StorageAdapter {
  return {
    tasks: new DrizzleTaskStorage(db),
    projects: new DrizzleProjectStorage(db),
    workspaces: new DrizzleWorkspaceStorage(db),
    events: new DrizzleEventStorage(db),
    learnings: new DrizzleLearningStorage(db),
    contextRequests: new DrizzleContextRequestStorage(db),
  }
}
