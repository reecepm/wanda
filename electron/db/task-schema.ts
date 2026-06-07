import type { ProjectConfig, TaskContext, WorkspaceConfig } from '@wanda/tasks'
import { type AnySQLiteColumn, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ---------------------------------------------------------------------------
// Task Workspaces
// ---------------------------------------------------------------------------

export const taskWorkspaces = sqliteTable('task_workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  config: text('config', { mode: 'json' }).$type<WorkspaceConfig>().notNull().default({}),
  labels: text('labels', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
  metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
})

// ---------------------------------------------------------------------------
// Task Projects
// ---------------------------------------------------------------------------

export const taskProjects = sqliteTable(
  'task_projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => taskWorkspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    identifier: text('identifier').notNull(),
    description: text('description'),
    sequenceCounter: integer('sequence_counter').notNull().default(0),
    config: text('config', { mode: 'json' }).$type<ProjectConfig>().notNull().default({}),
    labels: text('labels', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('task_projects_workspace_id_idx').on(table.workspaceId)],
)

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => taskProjects.id, { onDelete: 'set null' }),
    sequenceId: integer('sequence_id'),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    content: text('content'),
    type: text('type', { enum: ['milestone', 'epic', 'task', 'subtask'] })
      .notNull()
      .default('task'),
    status: text('status', {
      enum: ['draft', 'pending', 'ready', 'in_progress', 'blocked', 'completed', 'failed'],
    })
      .notNull()
      .default('draft'),
    origin: text('origin', { enum: ['human', 'agent'] })
      .notNull()
      .default('human'),
    assignable: text('assignable', { enum: ['human', 'agent', 'either'] })
      .notNull()
      .default('either'),
    priority: integer('priority').notNull().default(0),
    labels: text('labels', { mode: 'json' }).$type<Record<string, string>>().notNull().default({}),
    dependsOn: text('depends_on', { mode: 'json' }).$type<string[]>().notNull().default([]),
    claimedBy: text('claimed_by'),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    context: text('context', { mode: 'json' }).$type<TaskContext>().notNull().default({ own: null, inherited: null }),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_status_idx').on(table.status),
    index('tasks_priority_idx').on(table.priority),
    index('tasks_parent_id_idx').on(table.parentId),
  ],
)

// ---------------------------------------------------------------------------
// Task Learnings
// ---------------------------------------------------------------------------

export const taskLearnings = sqliteTable(
  'task_learnings',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    sourceTaskId: text('source_task_id').references(() => tasks.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('task_learnings_task_id_idx').on(table.taskId)],
)

// ---------------------------------------------------------------------------
// Task Context Requests
// ---------------------------------------------------------------------------

export const taskContextRequests = sqliteTable(
  'task_context_requests',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: text('agent_id'),
    question: text('question').notNull(),
    response: text('response'),
    status: text('status', { enum: ['pending', 'answered'] })
      .notNull()
      .default('pending'),
    autoBlocked: integer('auto_blocked', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    respondedAt: integer('responded_at', { mode: 'timestamp_ms' }),
    respondedBy: text('responded_by'),
  },
  (table) => [index('task_context_requests_task_id_idx').on(table.taskId)],
)

// ---------------------------------------------------------------------------
// Task Events
// ---------------------------------------------------------------------------

export const taskEvents = sqliteTable(
  'task_events',
  {
    id: text('id').primaryKey(),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    entityId: text('entity_id'),
    agentId: text('agent_id'),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    instanceId: text('instance_id').notNull(),
  },
  (table) => [
    uniqueIndex('task_events_position_idx').on(table.position),
    index('task_events_type_idx').on(table.type),
    index('task_events_entity_id_idx').on(table.entityId),
  ],
)

// ---------------------------------------------------------------------------
// Task Peers
// ---------------------------------------------------------------------------

export const taskPeers = sqliteTable(
  'task_peers',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    authToken: text('auth_token'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    autoClaimable: integer('auto_claimable', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('task_peers_name_idx').on(table.name)],
)
