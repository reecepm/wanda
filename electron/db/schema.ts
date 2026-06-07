// Domain types — imported for $type<> annotations in table definitions below.
// Services/router should import these from domains/ directly, not from this file.
import type {
  AgentCapabilities,
  AgentMode,
  Decision,
  ModelOption,
  PermissionRequest,
  ReasoningEffort,
} from '@wanda/agent-protocol'
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import type { AgentConfigPayload } from '../../shared/contracts/agent-config'
import type { WorkenvConfig, WorkenvResolvedPort, WorkenvRuntime, WorkenvState } from '../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../shared/contracts/workenv-runtime-state'
import type { NotificationPayload } from '../domains/notification/types'
import type {
  CommandArg,
  DetectedPort,
  PodGitContext,
  PodItemConfig,
  PodRuntime,
  ResolvedPort,
} from '../domains/pod/types'
import type { TaskViewConfig } from '../domains/settings/types'
import { viewConfigSchema, viewItemSettingsSchema } from '../domains/view/schemas'
import type { WandaMcpPolicy } from '../packages/agent-mcp'
import { jsonColumn } from './json-column'

// --- Validated JSON column schemas ----------------------------------------
// Zod mirrors of the structured config shapes stored in pod/view/agent JSON
// columns. `jsonColumn` runs these on every read so a row written by an older
// schema, hand-edited, or corrupted surfaces a typed JsonColumnError instead
// of flowing through the app as a silently-bad cast. The emitted SQL type
// stays `text`, so adopting them needs no migration.

// `contentType` on the row — not a field inside the config — discriminates the
// union, so members are matched structurally. They are ordered most-specific
// first and use loose objects so a matched row never silently drops the fields
// of a broader sibling shape.
const podItemConfigSchema: z.ZodType<PodItemConfig> = z.union([
  z.looseObject({
    podAgentId: z.string(),
    podTerminalId: z.string(),
    agentType: z.enum(['claude', 'codex', 'opencode']),
  }),
  z.looseObject({ podTerminalId: z.string() }),
  z.looseObject({ podCommandId: z.string() }),
  z.looseObject({ url: z.string() }),
  z.looseObject({ filePath: z.string() }),
  z.looseObject({
    sessionId: z.string().optional(),
    providerId: z.string().optional(),
    pending: z.boolean().optional(),
  }),
])

const agentConfigPayloadSchema: z.ZodType<AgentConfigPayload> = z.object({
  flags: z.record(z.string(), z.boolean()).optional(),
  extraArgs: z.array(z.string()).optional(),
})

const viewItemSettingsRecordSchema = z.record(z.string(), viewItemSettingsSchema)

export type { AgentConfigPayload } from '../../shared/contracts/agent-config'

/** Opaque per-provider resume handle. */
export type AgentPersistenceHandle = {
  readonly variant: string
  readonly [k: string]: unknown
}

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cwd: text('cwd').notNull().default(''),
  repoPath: text('repo_path'),
  /** Cached avatar URL derived from the git remote (e.g. github.com/{org}.png).
   *  null when no remote is detected or the host has no public avatar endpoint. */
  iconUrl: text('icon_url'),
  activeWorkspaceViewId: text('active_workspace_view_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const pods = sqliteTable(
  'pods',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    cwd: text('cwd').notNull(),
    shell: text('shell'),
    env: text('env', { mode: 'json' }).$type<Record<string, string>>(),
    status: text('status', { enum: ['stopped', 'running', 'failed', 'starting', 'stopping'] })
      .notNull()
      .default('stopped'),
    workenvId: text('workenv_id').references((): AnySQLiteColumn => workenvs.id, { onDelete: 'set null' }),
    runtime: text('runtime', { mode: 'json' }).$type<PodRuntime>(),
    containerId: text('container_id'),
    resolvedPorts: text('resolved_ports', { mode: 'json' }).$type<ResolvedPort[] | null>(),
    detectedPorts: text('detected_ports', { mode: 'json' }).$type<DetectedPort[] | null>(),
    containerLifecycle: text('container_lifecycle').notNull().default('inherit'),
    sliceBranch: text('slice_branch'),
    gitContext: text('git_context', { mode: 'json' }).$type<PodGitContext | null>(),
    wandaMcpPolicy: text('wanda_mcp_policy', {
      enum: ['inherit', 'include', 'exclude'],
    }).$type<WandaMcpPolicy | null>(),
    activeViewId: text('active_view_id'),
    isTemplate: integer('is_template', { mode: 'boolean' }).notNull().default(false),
    templateDescription: text('template_description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('pods_workspace_id_idx').on(table.workspaceId),
    index('pods_status_idx').on(table.status),
    index('pods_is_template_idx').on(table.isTemplate),
    index('pods_workenv_id_idx').on(table.workenvId),
  ],
)

export const podTerminals = sqliteTable(
  'pod_terminals',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    command: text('command'),
    args: text('args', { mode: 'json' }).$type<string[]>(),
    env: text('env', { mode: 'json' }).$type<Record<string, string>>(),
    restartPolicy: text('restart_policy', { enum: ['never', 'on-failure', 'always'] })
      .notNull()
      .default('never'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('pod_terminals_pod_id_idx').on(table.podId)],
)

// --- Pod items ---

export const podItems = sqliteTable(
  'pod_items',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    label: text('label').notNull(),
    labelSource: text('label_source').notNull().default('default'),
    config: jsonColumn('config', podItemConfigSchema).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('pod_items_pod_id_idx').on(table.podId)],
)

// --- View tables ---

export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    viewType: text('view_type').notNull().default('tabs'),
    config: jsonColumn('config', viewConfigSchema),
    itemSettings: jsonColumn('item_settings', viewItemSettingsRecordSchema).notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('views_pod_id_idx').on(table.podId)],
)

export const workspaceViews = sqliteTable(
  'workspace_views',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    viewType: text('view_type').notNull().default('columns'),
    config: jsonColumn('config', viewConfigSchema)
      .notNull()
      .default({ type: 'columns', rows: [{ items: [] }] }),
    itemSettings: jsonColumn('item_settings', viewItemSettingsRecordSchema).notNull().default({}),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('workspace_views_workspace_id_idx').on(table.workspaceId)],
)

export const viewTemplates = sqliteTable('view_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  scope: text('scope', { enum: ['global', 'workspace'] })
    .notNull()
    .default('global'),
  scopeId: text('scope_id'),
  viewType: text('view_type').notNull().default('tabs'),
  config: jsonColumn('config', viewConfigSchema),
  itemDefaults: text('item_defaults', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

/** Shape of a terminal entry stored in a launch template's terminals JSON column. */
export type LaunchTerminalDef = {
  name: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  restartPolicy?: 'never' | 'on-failure' | 'always'
}

export const launchTemplates = sqliteTable('launch_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  scope: text('scope', { enum: ['global', 'workspace'] })
    .notNull()
    .default('global'),
  scopeId: text('scope_id'),
  terminals: text('terminals', { mode: 'json' }).$type<LaunchTerminalDef[]>().notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// --- Workspace settings table ---

export const workspaceSettings = sqliteTable('workspace_settings', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  defaultTemplatePodId: text('default_template_pod_id').references(() => pods.id, { onDelete: 'set null' }),
  defaultWorkenvTemplateId: text('default_workenv_template_id'),
  autoGeneratePodName: integer('auto_generate_pod_name', { mode: 'boolean' }).notNull().default(false),
  defaultRuntime: text('default_runtime', { enum: ['pty', 'docker'] }),
  gitWorktreeEnabled: integer('git_worktree_enabled', { mode: 'boolean' }).notNull().default(false),
  gitWorktreeCopyHiddenFiles: integer('git_worktree_copy_hidden_files', { mode: 'boolean' }).notNull().default(false),
  worktreeLocationMode: text('worktree_location_mode', { enum: ['app-default', 'alongside', 'custom'] }),
  worktreeBaseDir: text('worktree_base_dir'),
  branchFrom: text('branch_from'),
  remoteOrigin: text('remote_origin'),
  scriptSetup: text('script_setup'),
  scriptRun: text('script_run'),
  scriptArchive: text('script_archive'),
  /** Globs matching auto-generated files. Defaults apply when null. */
  autoGeneratedGlobs: text('auto_generated_globs', { mode: 'json' }).$type<string[] | null>(),
  wandaMcpPolicy: text('wanda_mcp_policy', { enum: ['inherit', 'include', 'exclude'] }).$type<WandaMcpPolicy | null>(),
  /** Whether the workspace opts into Graphite (gt) stacked-PR workflows. */
  graphiteEnabled: integer('graphite_enabled', { mode: 'boolean' }).notNull().default(false),
  /** Primary commit action shown in the action panel. */
  graphiteDefaultCommit: text('graphite_default_commit', { enum: ['modify', 'newCommit', 'create'] })
    .notNull()
    .default('modify'),
  /** Primary push action shown in the action panel. */
  graphiteDefaultPush: text('graphite_default_push', { enum: ['submitStack', 'submitCurrent', 'gitPush'] })
    .notNull()
    .default('submitStack'),
  /** Primary pull action shown in the action panel. */
  graphiteDefaultPull: text('graphite_default_pull', { enum: ['sync', 'gitPull'] })
    .notNull()
    .default('sync'),
  /** Primary new-branch action shown in the action panel. */
  graphiteDefaultBranch: text('graphite_default_branch', { enum: ['create', 'gitCheckoutB'] })
    .notNull()
    .default('create'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// --- Task view tables ---

export const taskViews = sqliteTable('task_views', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  config: text('config', { mode: 'json' }).$type<TaskViewConfig>().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

// --- Notification tables ---

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    type: text('type', {
      enum: [
        'agent:permission-request',
        'workflow:input-required',
        'terminal:exit',
        'workflow:run-failed',
        'workflow:run-completed',
      ],
    }).notNull(),
    priority: text('priority', { enum: ['blocking', 'urgent', 'info'] }).notNull(),
    podId: text('pod_id').references(() => pods.id, { onDelete: 'cascade' }),
    podTerminalId: text('pod_terminal_id').references(() => podTerminals.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    payload: text('payload', { mode: 'json' }).$type<NotificationPayload | null>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolution: text('resolution'),
  },
  (table) => [
    index('notifications_pod_id_idx').on(table.podId),
    index('notifications_pod_terminal_id_idx').on(table.podTerminalId),
    index('notifications_workspace_id_idx').on(table.workspaceId),
    index('notifications_unresolved_idx').on(table.resolvedAt, table.priority),
  ],
)

// --- Pod agents ---

export const podAgents = sqliteTable(
  'pod_agents',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    podTerminalId: text('pod_terminal_id')
      .notNull()
      .references(() => podTerminals.id, { onDelete: 'cascade' }),
    agentType: text('agent_type', { enum: ['claude', 'codex', 'opencode'] }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('pod_agents_pod_id_idx').on(table.podId),
    uniqueIndex('pod_agents_terminal_idx').on(table.podTerminalId),
  ],
)

// --- Agent configs ---
// Polymorphic per-agent configuration at global/workspace/pod scope.
// Resolution order: pod > workspace > global > hardcoded defaults.

export const agentConfigs = sqliteTable(
  'agent_configs',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['global', 'workspace', 'pod'] }).notNull(),
    // Workspace or pod id; for global scope use the sentinel '__global__' so the
    // unique (scope, scope_id, agent_type) index treats global as a distinct row.
    scopeId: text('scope_id').notNull(),
    agentType: text('agent_type', { enum: ['claude', 'codex', 'opencode'] }).notNull(),
    config: jsonColumn('config', agentConfigPayloadSchema).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('agent_configs_scope_idx').on(table.scope, table.scopeId, table.agentType),
    index('agent_configs_scope_id_idx').on(table.scopeId),
  ],
)

// --- Pod commands ---

export const podCommands = sqliteTable(
  'pod_commands',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    command: text('command').notNull(),
    directory: text('directory'),
    directoryMode: text('directory_mode', { enum: ['absolute', 'relative'] })
      .notNull()
      .default('absolute'),
    args: text('args', { mode: 'json' }).$type<CommandArg[]>(),
    autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('pod_commands_pod_id_idx').on(table.podId)],
)

// --- Command tags ---

export const commandTags = sqliteTable(
  'command_tags',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('command_tags_pod_name').on(table.podId, table.name)],
)

export const podCommandTags = sqliteTable(
  'pod_command_tags',
  {
    commandId: text('command_id')
      .notNull()
      .references(() => podCommands.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => commandTags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.commandId, table.tagId] }),
    index('pct_command_idx').on(table.commandId),
    index('pct_tag_idx').on(table.tagId),
  ],
)

// --- File review markers ---
// Tracks "viewed" state per file against a content hash. When the file's
// current hash differs from the stored hash, the file is treated as unviewed
// automatically (GitHub PR review semantics).

export const fileReviewMarkers = sqliteTable(
  'file_review_markers',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('file_review_markers_pod_file_unique').on(table.podId, table.filePath),
    index('file_review_markers_pod_id_idx').on(table.podId),
  ],
)

// --- Review sessions ---
// Each review is a session bound to a pod. There's at most one `draft` review
// per pod at a time (the active in-progress review); submitting freezes it and
// the next new comment auto-creates a fresh draft. Submitted reviews snapshot
// the HEAD commit so their comments can be shown against a known version.

export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    podId: text('pod_id')
      .notNull()
      .references(() => pods.id, { onDelete: 'cascade' }),
    state: text('state', { enum: ['draft', 'submitted'] })
      .notNull()
      .default('draft'),
    baseRef: text('base_ref'),
    headCommit: text('head_commit'),
    summary: text('summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('reviews_pod_id_idx').on(table.podId), index('reviews_pod_state_idx').on(table.podId, table.state)],
)

export const reviewComments = sqliteTable(
  'review_comments',
  {
    id: text('id').primaryKey(),
    reviewId: text('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    side: text('side', { enum: ['additions', 'deletions'] }).notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line'),
    // Snapshot of the anchored line content(s) at comment time. Used for
    // resolution detection against later file versions ("still present" vs
    // "changed" vs "resolved"). Plain text — newline-joined for multi-line.
    anchorContent: text('anchor_content'),
    // SHA-256 of anchorContent for quick equality checks.
    anchorHash: text('anchor_hash'),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('review_comments_review_idx').on(table.reviewId),
    index('review_comments_review_file_idx').on(table.reviewId, table.filePath),
  ],
)

// -----------------------------------------------------------------------------
// Auth sessions — incoming pairings.
//
// When another client pairs into this server, the resulting session (long-
// lived bearer credential + device metadata) is persisted here so paired
// clients survive server restarts. Without this table the AuthStore was
// purely in-memory, which meant every restart silently invalidated every
// paired client's session token (they'd re-authenticate as 401 on the next
// RPC call and their inventory would render as empty).
//
// Pairing tokens (short-lived, single-use) and ws tokens (30s) are still
// in-memory only — they're ephemeral by design.

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    sessionId: text('session_id').primaryKey(),
    sessionToken: text('session_token').notNull().unique(),
    role: text('role', { enum: ['owner', 'client'] }).notNull(),
    deviceName: text('device_name').notNull(),
    deviceOs: text('device_os').notNull(),
    deviceAppVersion: text('device_app_version').notNull(),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('auth_sessions_expires_idx').on(table.expiresAt)],
)

// Provider API keys — at-rest ciphertext for each agent provider's credential.
//
// Written by `SecretsService` via `encryptSecret(plaintext)`; read on provider
// init + on rotation. The plaintext never crosses the WS boundary — renderers
// can only query existence + updatedAt via `secrets.list`.
//
// providerId is the stable provider manifest id (`'anthropic'`, `'openai'`,
// etc.). One row per provider, overwritten on set.
export const providerSecrets = sqliteTable('provider_secrets', {
  providerId: text('provider_id').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// -----------------------------------------------------------------------------
// Agent subsystem — first-class chat sessions.
//
// One row per session. Created on agent.session.create; updated on state
// transitions and persistence-handle changes. The in-memory runtime is the
// source of truth for live sessions; this table exists so a restart can
// rehydrate them (provider.resume or fresh spawn under the same row).
// -----------------------------------------------------------------------------

export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    podId: text('pod_id').references(() => pods.id, { onDelete: 'set null' }),
    providerId: text('provider_id').notNull(),
    cwd: text('cwd').notNull(),
    title: text('title'),
    titleSource: text('title_source', { enum: ['auto', 'user'] })
      .notNull()
      .default('auto'),
    capabilities: text('capabilities', { mode: 'json' }).$type<AgentCapabilities>().notNull(),
    modes: text('modes', { mode: 'json' }).$type<AgentMode[]>().notNull().default([]),
    modelOptions: text('model_options', { mode: 'json' }).$type<ModelOption[]>().notNull().default([]),
    currentModeId: text('current_mode_id'),
    currentModelId: text('current_model_id'),
    currentReasoningEffort: text('current_reasoning_effort').$type<ReasoningEffort | null>(),
    persistenceHandle: text('persistence_handle', { mode: 'json' }).$type<AgentPersistenceHandle | null>(),
    state: text('state', {
      enum: ['idle', 'starting', 'running', 'error', 'closed'],
    })
      .notNull()
      .default('idle'),
    lastError: text('last_error'),
    lastEventSeq: integer('last_event_seq'),
    lastEventAt: integer('last_event_at', { mode: 'timestamp_ms' }),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('chat_sessions_workspace_id_idx').on(table.workspaceId),
    index('chat_sessions_pod_id_idx').on(table.podId),
    index('chat_sessions_provider_id_idx').on(table.providerId),
    index('chat_sessions_workspace_lastactive_idx').on(table.workspaceId, table.archivedAt, table.lastEventAt),
  ],
)

// -----------------------------------------------------------------------------
// Agent pending permissions — durable mirror of outstanding
// `permission.requested` events so the runtime can drain / re-emit prompts
// after a restart.
//
// `id` is the permission `requestId`. Rows are created when the runtime emits
// `permission.requested` and marked resolved when the user answers (or the
// turn is cancelled). Resolved rows are pruned after 7 days by a background
// sweep.
// -----------------------------------------------------------------------------

export const agentPendingPermissions = sqliteTable(
  'agent_pending_permissions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').notNull(),
    eventSeq: integer('event_seq').notNull(),
    request: text('request', { mode: 'json' }).$type<PermissionRequest>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    resolution: text('resolution', { mode: 'json' }).$type<Decision | null>(),
  },
  (table) => [
    index('agent_pending_permissions_session_idx').on(table.sessionId),
    index('agent_pending_permissions_unresolved_idx').on(table.resolvedAt),
  ],
)

// -----------------------------------------------------------------------------
// Agent attachments — metadata row for user/agent-uploaded blobs.
//
// Bytes live on disk under `<userData>/agent-attachments/<sha[0:2]>/<sha>.bin`
// so the event log stays small; this table carries only the lookup metadata
// + dedup (per-session uniqueness on sha256). Session-scoped on delete.
// -----------------------------------------------------------------------------

export const agentAttachments = sqliteTable(
  'agent_attachments',
  {
    id: text('id').primaryKey(),
    /**
     * Session the attachment is bound to. Nullable during the upload-before-
     * submit window: `agent.attachment.upload` inserts with a null session
     * and `agent.session.prompt` binds the row when the user actually sends
     * the message (a nightly GC prunes orphans).
     */
    sessionId: text('session_id').references(() => chatSessions.id, { onDelete: 'cascade' }),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    originalFilename: text('original_filename'),
    source: text('source', { enum: ['user', 'agent'] }).notNull(),
    firstReferencedTurnId: text('first_referenced_turn_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('agent_attachments_session_id_idx').on(table.sessionId),
    // Per-session dedup: re-uploading the same bytes inside the same session
    // (or as a pre-bind null-session upload) returns the existing row's id.
    // Orphan uploads (sessionId IS NULL) land in a separate partition and
    // can still dedup within the null cohort.
    uniqueIndex('agent_attachments_session_sha_idx').on(table.sessionId, table.sha256),
  ],
)

// -----------------------------------------------------------------------------
// Permission policies — persisted allow/deny decisions with `scope: 'always'`.
//
// Evaluated in the runtime's permission bridge before forwarding a
// `permission.requested` to the client. On match, synthesize an immediate
// `permission.resolved` with the stored decision and never show the user a
// prompt.
// -----------------------------------------------------------------------------

export type PermissionPolicyDecision = { behaviour: 'allow' } | { behaviour: 'deny'; message?: string }

export const permissionPolicies = sqliteTable(
  'permission_policies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // Stable provider manifest id (`'claude-sdk'`, `'claude-code'`, ...).
    // `'*'` means "any provider" — policy applies across providers in the
    // workspace.
    providerId: text('provider_id').notNull(),
    toolKind: text('tool_kind', {
      enum: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'terminal', 'other', '*'],
    }).notNull(),
    // Optional narrower tool name (e.g. `'bash'`, `'Edit'`, `'Write'`).
    // `'*'` = any.
    toolName: text('tool_name').notNull().default('*'),
    // Glob against the ACP `locations[]` of the tool call. Empty string
    // matches tool calls that have no location info.
    locationPattern: text('location_pattern').notNull().default('**'),
    decision: text('decision', { mode: 'json' }).$type<PermissionPolicyDecision>().notNull(),
    // Session that produced the `scope: 'always'` response. Null when
    // authored directly via settings UI.
    createdBySessionId: text('created_by_session_id'),
    // Optional TTL. Null = permanent until user revokes.
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // At most one policy per (workspace, provider, toolKind, toolName, pattern).
    // "always allow" followed by "always deny" for the exact same quad is an
    // update, not a duplicate.
    uniqueIndex('permission_policies_key_unique').on(
      table.workspaceId,
      table.providerId,
      table.toolKind,
      table.toolName,
      table.locationPattern,
    ),
    // Hot-path lookup when resolving a `permission.requested` event.
    index('permission_policies_resolve_idx').on(table.workspaceId, table.providerId, table.toolKind),
  ],
)

// -----------------------------------------------------------------------------
// Workenv tables.
//
// A workenv is one VM/container hosting a backend dev stack for one git
// worktree. The server owns the lifecycle; rows here are authoritative,
// the WS event stream is observational.
//
// `config` carries the user-facing config (round-tripped whole). Anything
// queryable lives in its own column. `runtime_state` is opaque per-adapter
// state — adapters MUST NOT extend this table; new fields go in JSON.
// `adapter_handle` is the adapter-assigned handle (e.g. orbstack vm name)
// that uniquely identifies the underlying VM within (runtime). Null until
// the adapter's create() succeeds.
// -----------------------------------------------------------------------------

export const workenvTemplates = sqliteTable('workenv_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  runtime: text('runtime', { enum: ['orbstack'] })
    .$type<WorkenvRuntime>()
    .notNull(),
  config: text('config', { mode: 'json' }).$type<Partial<WorkenvConfig>>().notNull(),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
})

export const workenvPrebuilds = sqliteTable(
  'workenv_prebuilds',
  {
    id: text('id').primaryKey(),
    runtime: text('runtime', { enum: ['orbstack'] })
      .$type<WorkenvRuntime>()
      .notNull(),
    configHash: text('config_hash').notNull(),
    adapterHandle: text('adapter_handle'),
    state: text('state', { enum: ['creating', 'ready', 'error'] })
      .$type<'creating' | 'ready' | 'error'>()
      .notNull(),
    config: text('config', { mode: 'json' }).$type<WorkenvConfig>().notNull(),
    runtimeState: text('runtime_state', { mode: 'json' }).$type<WorkenvRuntimeState | null>(),
    lastError: text('last_error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('workenv_prebuilds_runtime_idx').on(table.runtime),
    index('workenv_prebuilds_state_idx').on(table.state),
    uniqueIndex('workenv_prebuilds_runtime_handle_unique').on(table.runtime, table.adapterHandle),
  ],
)

export const workenvs = sqliteTable(
  'workenvs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    worktreePath: text('worktree_path').notNull(),
    runtime: text('runtime', { enum: ['orbstack'] })
      .$type<WorkenvRuntime>()
      .notNull(),
    /** Adapter-assigned handle (e.g. OrbStack vm name). Null until create() succeeds. */
    adapterHandle: text('adapter_handle'),
    state: text('state', {
      enum: ['creating', 'stopped', 'starting', 'running', 'stopping', 'destroyed', 'error', 'stranded'],
    })
      .$type<WorkenvState>()
      .notNull()
      .default('creating'),
    configHash: text('config_hash').notNull(),
    config: text('config', { mode: 'json' }).$type<WorkenvConfig>().notNull(),
    runtimeState: text('runtime_state', { mode: 'json' }).$type<WorkenvRuntimeState | null>(),
    resolvedPorts: text('resolved_ports', { mode: 'json' }).$type<WorkenvResolvedPort[] | null>(),
    templateId: text('template_id').references(() => workenvTemplates.id, { onDelete: 'set null' }),
    lastError: text('last_error'),
    lastHealthyAt: integer('last_healthy_at', { mode: 'timestamp_ms' }),
    lastStartedAt: integer('last_started_at', { mode: 'timestamp_ms' }),
    lastStoppedAt: integer('last_stopped_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('workenvs_slug_unique').on(table.slug),
    index('workenvs_runtime_idx').on(table.runtime),
    index('workenvs_state_idx').on(table.state),
    // SQLite treats each NULL as distinct in unique indexes, so multiple
    // pre-create rows (adapter_handle = NULL) coexist; once an adapter
    // assigns a handle, it must be unique within (runtime).
    uniqueIndex('workenvs_runtime_handle_unique').on(table.runtime, table.adapterHandle),
  ],
)

export const workenvEvents = sqliteTable(
  'workenv_events',
  {
    id: text('id').primaryKey(),
    workenvId: text('workenv_id')
      .notNull()
      .references(() => workenvs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('workenv_events_workenv_id_idx').on(table.workenvId),
    index('workenv_events_workenv_id_type_idx').on(table.workenvId, table.type),
    index('workenv_events_created_at_idx').on(table.createdAt),
  ],
)

// -----------------------------------------------------------------------------
// Plans — workspace-scoped durable documents (PRDs, task plans, proposals).
//
// Plans are the central knowledge management surface: a single document
// edited by humans in a Plate UI and read/written by agents over MCP.
// They outlive pods (links downward are *soft* — no FK — so the plan
// remains a source of truth even when its work has shipped or been thrown
// away). Bodies are markdown stored in the DB so a plan isn't tied to one
// worktree's filesystem and survives pod / branch deletion.
//
// Optimistic locking: every body or metadata write bumps `version` and the
// caller must pass `expectedVersion`. Whole-doc locking is intentional —
// agent-initiated mutations go through structured tools (appendNote,
// addLink, addComment, setStatus) that target distinct ranges or
// append-only logs and never conflict with user edits.
//
// The status enum drives discoverability: `active` plans are returned by
// agent search; `draft`, `superseded`, `archived` are excluded by default.

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** URL-friendly stable handle; unique within a workspace. */
    slug: text('slug').notNull(),
    /** Distinguishes long-lived PRDs from short-lived review-loop documents. */
    kind: text('kind', { enum: ['prd', 'task-plan', 'proposal'] })
      .notNull()
      .default('prd'),
    status: text('status', {
      enum: ['draft', 'active', 'completed', 'archived', 'superseded'],
    })
      .notNull()
      .default('draft'),
    title: text('title').notNull(),
    /** Markdown source of truth. Plate UI deserializes/reserializes on edit. */
    body: text('body').notNull().default(''),
    /** Optimistic-locking token. Bumped on every body/metadata write. */
    version: integer('version').notNull().default(1),
    /** Days after `lastHumanReviewAt` that agent reads receive a staleness warning. null = never stale. */
    staleAfterDays: integer('stale_after_days'),
    /** Last time a human user made an explicit edit/review action. null until first human touch. */
    lastHumanReviewAt: integer('last_human_review_at', { mode: 'timestamp_ms' }),
    /** Soft ref to the chat session that submitted this plan for review. Set when kind in (proposal,task-plan) and submitted via MCP. */
    submittedByChatSessionId: text('submitted_by_chat_session_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('plans_workspace_idx').on(table.workspaceId),
    index('plans_workspace_status_idx').on(table.workspaceId, table.status),
    uniqueIndex('plans_workspace_slug_unique').on(table.workspaceId, table.slug),
  ],
)

// Append-only revision log. Every body write creates a row here so we can
// show "who changed what" (user vs agent, with author id) in the detail
// view's revisions drawer. Not strictly required for correctness — the
// current body is on `plans` — but cheap to maintain and load-bearing for
// agent-trust ("this section was last touched by chat session X 3 hours
// ago").
export const planRevisions = sqliteTable(
  'plan_revisions',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    /** Parent revision (for fork/merge UIs later). null for the initial revision. */
    parentRevisionId: text('parent_revision_id'),
    authorKind: text('author_kind', { enum: ['user', 'agent'] }).notNull(),
    /** Free-form author identifier — chat session id, user id, or 'local'. */
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    /** Optional one-line summary of the change. */
    summary: text('summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('plan_revisions_plan_idx').on(table.planId, table.createdAt)],
)

// Comments anchor to either a Plate block (by opaque anchor id assigned
// when the block is first persisted) or to the document as a whole
// (anchor = null). For v1 anchors are flat strings; range-within-block
// granularity comes later when the Plate Comments plugin lands.
export const planComments = sqliteTable(
  'plan_comments',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    /** Opaque anchor (Plate block id, heading slug, or null for document-level). */
    anchor: text('anchor'),
    authorKind: text('author_kind', { enum: ['user', 'agent'] }).notNull(),
    authorId: text('author_id').notNull(),
    body: text('body').notNull(),
    /**
     * Whether this comment is included in the agent feedback bundle when a
     * review-loop plan is approved or sent back for changes. Defaults true
     * for review-loop plans and false for PRD-mode comments — the router
     * sets the per-plan default on insert.
     */
    includeInFeedback: integer('include_in_feedback', { mode: 'boolean' }).notNull().default(false),
    resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('plan_comments_plan_idx').on(table.planId),
    index('plan_comments_plan_anchor_idx').on(table.planId, table.anchor),
  ],
)

// Soft links from a plan to other entities — workenvs, pods, chat
// sessions, branches. No FK: plans persist when their linked work is
// deleted. The link table exists so list views can filter by "plans
// linked to this pod" and so completion prompts can fire when a linked
// branch merges.
export const planLinks = sqliteTable(
  'plan_links',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['workenv', 'pod', 'chatSession', 'branch'] }).notNull(),
    /** Opaque ref id; semantics depend on `kind`. */
    refId: text('ref_id').notNull(),
    /** Human-readable label (branch name, pod label, etc). */
    label: text('label'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('plan_links_plan_idx').on(table.planId),
    index('plan_links_kind_ref_idx').on(table.kind, table.refId),
    uniqueIndex('plan_links_plan_kind_ref_unique').on(table.planId, table.kind, table.refId),
  ],
)
