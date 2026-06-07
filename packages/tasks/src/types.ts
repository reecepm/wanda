// ---------------------------------------------------------------------------
// Enums / Literals
// ---------------------------------------------------------------------------

export type TaskStatus = 'draft' | 'pending' | 'ready' | 'in_progress' | 'blocked' | 'completed' | 'failed'

export type TaskType = 'milestone' | 'epic' | 'task' | 'subtask'

export type TaskOrigin = 'human' | 'agent'

export type TaskAssignable = 'human' | 'agent' | 'either'

export type AgentType = 'human' | 'cli' | 'orchestrator' | 'runner'

export type AgentStatus = 'online' | 'busy' | 'idle' | 'offline' | 'draining'

export type ContextRequestStatus = 'pending' | 'answered'

export type TaskEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.status_changed'
  | 'task.claimed'
  | 'task.released'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'task.unblocked'
  | 'context.requested'
  | 'context.answered'
  | 'learning.added'
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.archived'

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface Task {
  id: string
  projectId: string | null
  sequenceId: number | null
  parentId: string | null
  title: string
  description: string | null
  content: string | null
  type: TaskType
  status: TaskStatus
  origin: TaskOrigin
  assignable: TaskAssignable
  priority: number
  labels: Record<string, string>
  dependsOn: string[]
  claimedBy: string | null
  claimedAt: number | null
  leaseExpiresAt: number | null
  context: TaskContext
  version: number
  createdBy: string | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
  archivedAt: number | null
}

export interface TaskContext {
  own: string | null
  inherited: string | null
}

export interface Lease {
  taskId: string
  agentId: string
  claimedAt: number
  expiresAt: number | null
}

export interface Project {
  id: string
  workspaceId: string
  name: string
  identifier: string
  description: string | null
  sequenceCounter: number
  config: ProjectConfig
  labels: Record<string, string>
  metadata: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface ProjectConfig {
  autoClaimSubtasks?: boolean
  requireReview?: boolean
  allowedAgentTags?: string[]
  maxConcurrentTasks?: number
  defaultLeaseTtl?: number
  schedulingStrategy?: 'priority' | 'fifo'
  autoBlockOnContextRequest?: boolean
}

export interface Workspace {
  id: string
  name: string
  description: string | null
  config: WorkspaceConfig
  labels: Record<string, string>
  metadata: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
  archivedAt: number | null
}

export interface WorkspaceConfig {
  allowedAgentTags?: string[]
  maxProjects?: number
  defaultLeaseTtl?: number
}

export interface Learning {
  id: string
  taskId: string
  sourceTaskId: string | null
  content: string
  createdAt: number
}

export interface ContextRequest {
  id: string
  taskId: string
  agentId: string | null
  question: string
  response: string | null
  status: ContextRequestStatus
  autoBlocked: boolean
  createdAt: number
  respondedAt: number | null
  respondedBy: string | null
}

export interface TaskEvent {
  id: string
  position: number
  type: TaskEventType
  entityId: string
  agentId: string | null
  data: Record<string, unknown>
  timestamp: number
  instanceId: string
}

// ---------------------------------------------------------------------------
// Input types (for creating / updating)
// ---------------------------------------------------------------------------

export interface NewTask {
  title: string
  projectId?: string | null
  parentId?: string | null
  description?: string | null
  content?: string | null
  type?: TaskType
  status?: 'draft' | 'ready'
  origin?: TaskOrigin
  assignable?: TaskAssignable
  priority?: number
  labels?: Record<string, string>
  dependsOn?: string[]
  context?: string | null
  createdBy?: string | null
}

export interface TaskUpdate {
  title?: string
  description?: string | null
  content?: string | null
  type?: TaskType
  status?: TaskStatus
  assignable?: TaskAssignable
  priority?: number
  labels?: Record<string, string>
  dependsOn?: string[]
  context?: string | null
}

export interface NewProject {
  name: string
  workspaceId: string
  identifier: string
  description?: string | null
  config?: ProjectConfig
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface ProjectUpdate {
  name?: string
  description?: string | null
  config?: ProjectConfig
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface NewWorkspace {
  name: string
  description?: string | null
  config?: WorkspaceConfig
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface WorkspaceUpdate {
  name?: string
  description?: string | null
  config?: WorkspaceConfig
  labels?: Record<string, string>
  metadata?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Filter / query types
// ---------------------------------------------------------------------------

export interface TaskFilter {
  projectId?: string
  parentId?: string | null
  status?: TaskStatus[]
  type?: TaskType[]
  assignable?: TaskAssignable[]
  origin?: TaskOrigin[]
  claimedBy?: string
  ids?: string[]
  archived?: boolean
  source?: 'local' | 'remote' | string
}

export interface ProjectFilter {
  workspaceId?: string
  archived?: boolean
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ClaimOptions {
  leaseTtl?: number
}

export interface RenewOptions {
  ttl?: number
}

export interface NextReadyOptions {
  projectId?: string
  assignable?: TaskAssignable
  agentTags?: string[]
}

export interface TaskResult {
  output?: string
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Task tree (for getTree)
// ---------------------------------------------------------------------------

export interface TaskTreeNode {
  task: Task
  children: TaskTreeNode[]
}

// ---------------------------------------------------------------------------
// Peer status
// ---------------------------------------------------------------------------

export interface PeerStatus {
  name: string
  connected: boolean
  taskCount: number
}

export interface PeerConfig {
  name: string
  meta?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Store options
// ---------------------------------------------------------------------------

export interface TaskStoreOptions {
  storage: import('./interfaces.ts').StorageAdapter
  instanceName: string
}
