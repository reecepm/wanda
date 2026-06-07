// Type-only barrel for domain types consumed across the client/server
// boundary. This file owns boundary shapes; backend domains may re-export
// these types, but shared contracts must not import from `electron/**`.

// --- Pod types -------------------------------------------------------------

export type AgentType = 'claude' | 'codex' | 'opencode'

export type PodRuntime =
  | null
  | { type: 'pty' }
  | {
      type: 'docker'
      image: string
      resources?: { memory?: number; cpus?: number }
      env?: Record<string, string>
      mounts?: Array<{ source: string; target: string; readonly?: boolean }>
      workDir?: string
      ports?: Array<{ containerPort: number; protocol?: 'tcp' | 'udp'; label?: string }>
      /** Set to false to disable SSH setup (port 22, sshd, SSH config). Default: true */
      ssh?: boolean
    }

export type DetectedPort = { containerPort: number; process?: string }

export type ResolvedPort = {
  containerPort: number
  hostPort: number
  protocol: 'tcp' | 'udp'
  label?: string
}

export type TerminalItemConfig = { podTerminalId: string }
export type BrowserItemConfig = { url: string }
export type AgentItemConfig = { podAgentId: string; podTerminalId: string; agentType: AgentType }
export type AgentSessionItemConfig = { sessionId?: string; providerId?: string; pending?: boolean }
export type CommandItemConfig = { podCommandId: string }
/** Markdown editor item — filePath is relative to the pod's cwd. */
export type MarkdownItemConfig = { filePath: string }
export type PodItemConfig =
  | TerminalItemConfig
  | BrowserItemConfig
  | AgentItemConfig
  | AgentSessionItemConfig
  | CommandItemConfig
  | MarkdownItemConfig

// --- View types ------------------------------------------------------------

export type SplitLeaf = {
  type: 'leaf'
  itemId: string
}

export type SplitBranch = {
  type: 'branch'
  direction: 'horizontal' | 'vertical'
  children: [SplitNode, SplitNode]
  sizes: [number, number]
}

export type SplitNode = SplitLeaf | SplitBranch

export type TabsViewConfig = { type: 'tabs'; focusedItemId?: string }

export type PaneTabGroup = {
  tabIds: string[]
  activeTabId: string | null
}

export type SplitPaneViewConfig = {
  type: 'split-pane'
  layout: SplitNode
  paneTabs?: Record<string, PaneTabGroup>
  focusedItemId?: string
}

export type GridWidget = {
  itemId: string
  x: number
  y: number
  w: number
  h: number
}

export type GridViewConfig = {
  type: 'grid'
  widgets: GridWidget[]
  columns?: number
  rowHeight?: number
  focusedItemId?: string
}

export type CarouselItem = { itemId: string; width: number }
export type CarouselViewConfig = { type: 'carousel'; items: CarouselItem[]; focusedItemId?: string }

export type ColumnsRow = { items: { itemId: string; width: number }[] }
export type ColumnsViewConfig = { type: 'columns'; rows: ColumnsRow[]; focusedItemId?: string }

export type CanvasNode = { itemId: string; x: number; y: number; width: number; height: number }
export type CanvasViewport = { x: number; y: number; zoom: number }
export type CanvasViewConfig = {
  type: 'canvas'
  nodes: CanvasNode[]
  viewport?: CanvasViewport
  focusedItemId?: string
}

export type ViewConfig =
  | TabsViewConfig
  | SplitPaneViewConfig
  | GridViewConfig
  | CarouselViewConfig
  | ColumnsViewConfig
  | CanvasViewConfig

export type ViewItem = {
  id: string
  podId?: string
  contentType: 'terminal' | 'browser' | 'agent' | 'agent-session' | 'command' | 'markdown'
  label: string
  labelSource?: 'default' | 'terminal' | 'user'
  config: PodItemConfig
  pinned?: boolean
  sortOrder: number
}

export type TabsItemSettings = { sortOrder: number; pinned?: boolean }
export type ViewItemSettings = TabsItemSettings

// --- Settings types --------------------------------------------------------

export type TaskFilterConfig = {
  projectIds?: string[]
  statuses?: string[]
  types?: string[]
  priorities?: number[]
}

export type TaskViewConfig = {
  filters: TaskFilterConfig
  groupBy: 'status' | 'type' | 'priority' | 'project' | 'none'
  sortBy: 'created' | 'updated' | 'priority' | 'title' | 'status'
  sortDirection: 'asc' | 'desc'
  layout: 'grouped-list' | 'board'
  collapsedGroups: string[]
  showCompletedTasks: boolean
  fields: ('type' | 'priority' | 'labels' | 'project' | 'created')[]
}

// --- Review types ----------------------------------------------------------

export type ReviewState = 'draft' | 'submitted'
export type ReviewSide = 'additions' | 'deletions'

export interface Review {
  id: string
  podId: string
  state: ReviewState
  baseRef: string | null
  /** HEAD commit snapshot captured when the review was submitted (null for drafts). */
  headCommit: string | null
  /** Optional top-level summary. */
  summary: string | null
  createdAt: number
  updatedAt: number
  submittedAt: number | null
}

export interface ReviewComment {
  id: string
  reviewId: string
  filePath: string
  side: ReviewSide
  startLine: number
  /** null for single-line comments. */
  endLine: number | null
  /** Plain text snapshot of the anchored line(s) at comment time. */
  anchorContent: string | null
  anchorHash: string | null
  body: string
  createdAt: number
  updatedAt: number
}

export type CommentResolution = 'unresolved' | 'changed' | 'resolved' | 'unknown'

export interface ReviewCommentWithResolution extends ReviewComment {
  resolution: CommentResolution
}

// --- Plan types ------------------------------------------------------------

export type PlanKind = 'prd' | 'task-plan' | 'proposal'
export type PlanStatus = 'draft' | 'active' | 'completed' | 'archived' | 'superseded'
export type PlanAuthorKind = 'user' | 'agent'
export type PlanLinkKind = 'workenv' | 'pod' | 'chatSession' | 'branch'

export interface Plan {
  id: string
  workspaceId: string
  slug: string
  kind: PlanKind
  status: PlanStatus
  title: string
  body: string
  version: number
  staleAfterDays: number | null
  lastHumanReviewAt: number | null
  submittedByChatSessionId: string | null
  createdAt: number
  updatedAt: number
}

export interface PlanRevision {
  id: string
  planId: string
  parentRevisionId: string | null
  authorKind: PlanAuthorKind
  authorId: string
  body: string
  summary: string | null
  createdAt: number
}

export interface PlanComment {
  id: string
  planId: string
  anchor: string | null
  authorKind: PlanAuthorKind
  authorId: string
  body: string
  includeInFeedback: boolean
  resolvedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface PlanLink {
  id: string
  planId: string
  kind: PlanLinkKind
  refId: string
  label: string | null
  createdAt: number
}

export interface PlanStaleness {
  isStale: boolean
  /** Reason populated when isStale is true. */
  reason: 'never_reviewed' | 'past_ttl' | 'inactive_status' | null
  /** Days since the last human review (null if never reviewed). */
  ageDays: number | null
}

export interface PlanWithMeta extends Plan {
  staleness: PlanStaleness
  links: PlanLink[]
}

// --- Task types (from @wanda/tasks) ----------------------------------------
export type {
  ClaimOptions,
  ContextRequest,
  Learning,
  Lease,
  NewProject,
  NewTask,
  NewWorkspace as TaskNewWorkspace,
  NextReadyOptions,
  PeerConfig,
  PeerStatus,
  Project,
  ProjectConfig,
  ProjectFilter,
  ProjectUpdate,
  RenewOptions,
  Task,
  TaskAssignable,
  TaskContext,
  TaskEvent,
  TaskEventType,
  TaskFilter,
  TaskOrigin,
  TaskResult,
  TaskStatus,
  TaskTreeNode,
  TaskType,
  TaskUpdate,
  Workspace as TaskWorkspace,
  WorkspaceConfig as TaskWorkspaceConfig,
  WorkspaceUpdate as TaskWorkspaceUpdate,
} from '@wanda/tasks'
