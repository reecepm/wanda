// -----------------------------------------------------------------------------
// Codex-side event translation into Wanda AgentEvents.
//
// Per spec 07 §6, we translate per turn, not per item: item/started +
// item/completed reshape into tool.started + tool.completed, deltas
// reshape into tool.updated (or text.delta / reasoning.delta when the
// item is a message/reasoning).
//
// State held here is all per-turn: item ids → message/tool binding, text
// buffers for the final `text.completed` commit. The provider owns the
// enclosing session scope and clears this on each new turn.
// -----------------------------------------------------------------------------

import type {
  AgentEvent,
  MessageId,
  PermissionAction,
  PlanItem,
  SessionId,
  ToolCallId,
  ToolKind,
  TurnId,
} from '@wanda/agent-protocol'
import { newMessageId } from '@wanda/agent-protocol'
import type { ProviderEmit } from '@wanda/agent-runtime'
import type {
  CodexItem,
  CodexPlanEntry,
  CommandExecOutputDeltaNotification,
  ErrorNotification,
  ItemCompletedNotification,
  ItemDeltaNotification,
  ItemStartedNotification,
  PlanUpdatedNotification,
  RawResponseItemCompletedNotification,
  RequestApprovalParams,
  TurnCompletedNotification,
} from './protocol.ts'

export interface CodexTurnContext {
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly emit: ProviderEmit
}

export interface CodexTurnBuffers {
  /** itemId → active assistant-message id, for coalescing text.delta. */
  readonly textByItem: Map<string, { messageId: MessageId; buffer: string }>
  /** Assistant item ids already committed, used to dedupe final turn snapshots. */
  readonly completedTextItemIds: Set<string>
  /** itemId → active reasoning id. */
  readonly reasoningByItem: Map<string, { messageId: MessageId; buffer: string }>
  /** itemId → Wanda toolCallId + item type, used on update/complete. */
  readonly toolByItem: Map<string, { toolCallId: ToolCallId; kind: ToolKind; terminated: boolean }>
  /** exec output buffers keyed by itemId + stream. */
  readonly execByItem: Map<string, { stdout: string; stderr: string }>
}

export function makeTurnBuffers(): CodexTurnBuffers {
  return {
    textByItem: new Map(),
    completedTextItemIds: new Set(),
    reasoningByItem: new Map(),
    toolByItem: new Map(),
    execByItem: new Map(),
  }
}

// --- item/started -------------------------------------------------------------

export function onItemStarted(ctx: CodexTurnContext, buf: CodexTurnBuffers, note: ItemStartedNotification): void {
  const item = note.item
  switch (item.type) {
    case 'assistantMessage':
    case 'agentMessage': {
      const messageId = newMessageId()
      buf.textByItem.set(item.id, { messageId, buffer: '' })
      return
    }
    case 'reasoning': {
      const messageId = newMessageId()
      buf.reasoningByItem.set(item.id, { messageId, buffer: '' })
      return
    }
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'webSearch':
      emitToolStarted(ctx, buf, item)
      return
    default:
      // Unknown item type — safely ignore; we log once on the provider side.
      return
  }
}

// --- item/*/delta + command output-delta -------------------------------------

export function onAgentMessageDelta(ctx: CodexTurnContext, buf: CodexTurnBuffers, note: ItemDeltaNotification): void {
  const entry = buf.textByItem.get(note.itemId)
  if (!entry) return
  const text = note.delta
  if (text.length === 0) return
  const event: AgentEvent = {
    kind: 'text.delta',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    messageId: entry.messageId,
    text,
    index: entry.buffer.length,
  }
  ctx.emit(event)
  entry.buffer += text
}

export function onReasoningDelta(ctx: CodexTurnContext, buf: CodexTurnBuffers, note: ItemDeltaNotification): void {
  const entry = buf.reasoningByItem.get(note.itemId)
  if (!entry) return
  const text = note.delta
  if (text.length === 0) return
  const event: AgentEvent = {
    kind: 'reasoning.delta',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    messageId: entry.messageId,
    text,
    index: entry.buffer.length,
  }
  ctx.emit(event)
  entry.buffer += text
}

export function onCommandExecOutputDelta(
  ctx: CodexTurnContext,
  buf: CodexTurnBuffers,
  note: CommandExecOutputDeltaNotification,
): void {
  const tool = buf.toolByItem.get(note.itemId)
  if (!tool || tool.terminated) return
  // Codex 0.104: `delta` is plain UTF-8 and the server does not
  // distinguish stdout from stderr on the wire. We accumulate into a
  // single "output" stream — if separation becomes important, diff
  // against `item/completed.aggregatedOutput` when the item lands.
  const delta = typeof note.delta === 'string' ? note.delta : ''
  if (delta.length === 0) return
  const stream = buf.execByItem.get(note.itemId) ?? { stdout: '', stderr: '' }
  stream.stdout += delta
  buf.execByItem.set(note.itemId, stream)
  const event: AgentEvent = {
    kind: 'tool.updated',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    toolCallId: tool.toolCallId,
    status: 'in_progress',
    detail: {
      kind: 'other',
      toolName: 'codex-exec',
      payload: { stdout: stream.stdout, stderr: stream.stderr },
    },
  }
  ctx.emit(event)
}

export function onRawResponseItemCompleted(
  ctx: CodexTurnContext,
  buf: CodexTurnBuffers,
  note: RawResponseItemCompletedNotification,
): void {
  const item = note.item
  if (item.type !== 'message') return
  if (item.role && item.role !== 'assistant') return
  const text = (item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
  if (text.length === 0) return

  const itemId = typeof item.id === 'string' && item.id.length > 0 ? item.id : null
  if (itemId && buf.completedTextItemIds.has(itemId)) return
  const entry = itemId ? buf.textByItem.get(itemId) : undefined
  if (entry) {
    buf.textByItem.delete(itemId!)
    buf.completedTextItemIds.add(itemId!)
    ctx.emit({
      kind: 'text.completed',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      messageId: entry.messageId,
      text,
    })
    return
  }

  ctx.emit({
    kind: 'text.completed',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    messageId: newMessageId(),
    text,
  })
  if (itemId) buf.completedTextItemIds.add(itemId)
}

// --- item/completed -----------------------------------------------------------

export function onItemCompleted(ctx: CodexTurnContext, buf: CodexTurnBuffers, note: ItemCompletedNotification): void {
  const item = note.item
  switch (item.type) {
    case 'assistantMessage':
    case 'agentMessage': {
      if (buf.completedTextItemIds.has(item.id)) return
      const entry = buf.textByItem.get(item.id)
      const completedText = readAgentMessageText(item) ?? entry?.buffer ?? ''
      if (entry) buf.textByItem.delete(item.id)
      if (completedText.length === 0) return
      buf.completedTextItemIds.add(item.id)
      ctx.emit({
        kind: 'text.completed',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        messageId: entry?.messageId ?? newMessageId(),
        text: completedText,
      })
      return
    }
    case 'reasoning': {
      const entry = buf.reasoningByItem.get(item.id)
      const completedText = readReasoningText(item) ?? entry?.buffer ?? ''
      if (!entry && completedText.length === 0) return
      if (entry) buf.reasoningByItem.delete(item.id)
      if (completedText.length === 0) return
      ctx.emit({
        kind: 'reasoning.completed',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        messageId: entry?.messageId ?? newMessageId(),
        text: completedText,
      })
      return
    }
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'webSearch':
      emitToolCompleted(ctx, buf, item, note.status)
      return
    default:
      return
  }
}

export function onTurnCompletedItems(
  ctx: CodexTurnContext,
  buf: CodexTurnBuffers,
  note: TurnCompletedNotification,
): void {
  const items = Array.isArray(note.turn.items) ? note.turn.items : []
  for (const item of items) {
    if (isAgentMessageItem(item) && typeof item.id === 'string' && !buf.completedTextItemIds.has(item.id)) {
      const text = readAgentMessageText(item)
      if (!text) continue
      const entry = buf.textByItem.get(item.id)
      if (entry) buf.textByItem.delete(item.id)
      buf.completedTextItemIds.add(item.id)
      ctx.emit({
        kind: 'text.completed',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        messageId: entry?.messageId ?? newMessageId(),
        text,
      })
    }
  }
}

// --- turn/completed -----------------------------------------------------------

export function onTurnCompleted(ctx: CodexTurnContext, note: TurnCompletedNotification): void {
  // Codex 0.104 nests status under `turn`. Old versions had a top-level
  // `status`; fall back to either so protocol drift across versions
  // doesn't silently lose the outcome.
  const flat = note as unknown as { status?: unknown; error?: { message?: string; code?: string } }
  const status: string =
    (note.turn && typeof note.turn.status === 'string' && note.turn.status) ||
    (typeof flat.status === 'string' ? flat.status : '')
  const error = note.turn?.error ?? flat.error
  if (status === 'interrupted' || status === 'canceled') {
    ctx.emit({
      kind: 'turn.cancelled',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      acknowledged: true,
    })
    return
  }
  if (status === 'failed') {
    ctx.emit({
      kind: 'error',
      sessionId: ctx.sessionId,
      turnId: ctx.turnId,
      message: error?.message ?? 'Codex turn failed',
      code: error?.code,
      recoverable: false,
    })
    return
  }
  ctx.emit({
    kind: 'turn.completed',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    stopReason: 'end_turn',
  })
}

function isAgentMessageItem(item: CodexItem): boolean {
  return item.type === 'assistantMessage' || item.type === 'agentMessage'
}

function readAgentMessageText(item: CodexItem): string | null {
  const text = (item as { text?: unknown }).text
  return typeof text === 'string' && text.length > 0 ? text : null
}

function readReasoningText(item: CodexItem): string | null {
  const content = (item as { content?: unknown }).content
  if (Array.isArray(content)) {
    const joined = content.filter((part): part is string => typeof part === 'string').join('')
    if (joined.length > 0) return joined
  }
  const summary = (item as { summary?: unknown }).summary
  if (Array.isArray(summary)) {
    const joined = summary.filter((part): part is string => typeof part === 'string').join('')
    if (joined.length > 0) return joined
  }
  return null
}

// --- plan + error -------------------------------------------------------------

export function onPlanUpdated(ctx: CodexTurnContext, note: PlanUpdatedNotification): void {
  ctx.emit({
    kind: 'plan.updated',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    plan: note.plan.map(mapPlanEntry),
  })
}

export function onError(ctx: CodexTurnContext, note: ErrorNotification): void {
  const nested = note.error
  ctx.emit({
    kind: 'error',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    message: nested?.message ?? note.message ?? 'Codex error',
    recoverable: note.recoverable ?? note.willRetry ?? true,
    code: nested?.code ?? note.code,
  })
}

// --- tool.started / completed helpers ----------------------------------------

function emitToolStarted(ctx: CodexTurnContext, buf: CodexTurnBuffers, item: CodexItem): void {
  const toolCallId = item.id as unknown as ToolCallId
  const kind = codexItemToToolKind(item)
  buf.toolByItem.set(item.id, { toolCallId, kind, terminated: false })
  ctx.emit({
    kind: 'tool.started',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    toolCallId,
    toolKind: kind,
    title: typeof item.title === 'string' ? item.title : codexItemDefaultTitle(item),
    detail: codexItemStartDetail(item, kind),
  })
}

function emitToolCompleted(
  ctx: CodexTurnContext,
  buf: CodexTurnBuffers,
  item: CodexItem,
  status: ItemCompletedNotification['status'],
): void {
  const entry = buf.toolByItem.get(item.id)
  if (!entry || entry.terminated) return
  entry.terminated = true
  const wandaStatus: 'completed' | 'failed' | 'cancelled' =
    status === 'failed' ? 'failed' : status === 'canceled' ? 'cancelled' : 'completed'
  ctx.emit({
    kind: 'tool.completed',
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    toolCallId: entry.toolCallId,
    status: wandaStatus,
    result: codexItemResult(item),
  })
  buf.execByItem.delete(item.id)
}

// --- permission translation ---------------------------------------------------

export function buildApprovalPermissionRequest(
  kind: 'shell' | 'diff',
  params: RequestApprovalParams,
): {
  title: string
  detail: ReturnType<typeof buildApprovalDetail>
  actions: ReadonlyArray<PermissionAction>
} {
  const detail = buildApprovalDetail(kind, params)
  return {
    title:
      typeof params.title === 'string' && params.title.length > 0
        ? params.title
        : kind === 'shell'
          ? 'Codex wants to run a shell command'
          : 'Codex wants to apply a file change',
    detail,
    actions: [
      { id: 'accept', label: 'Allow once', behaviour: 'allow', scope: 'once' },
      { id: 'acceptForSession', label: 'Allow for session', behaviour: 'allow', scope: 'session' },
      { id: 'decline', label: 'Reject', behaviour: 'deny', scope: 'once' },
    ],
  }
}

function buildApprovalDetail(
  kind: 'shell' | 'diff',
  params: RequestApprovalParams,
): import('@wanda/agent-protocol').ToolCallDetail {
  const rawDetail = params.detail
  if (kind === 'shell') {
    const cmd =
      rawDetail && typeof rawDetail === 'object' && rawDetail !== null && 'command' in rawDetail
        ? String((rawDetail as { command: unknown }).command ?? '')
        : ''
    const cwd =
      rawDetail && typeof rawDetail === 'object' && rawDetail !== null && 'cwd' in rawDetail
        ? String((rawDetail as { cwd: unknown }).cwd ?? '')
        : undefined
    return { kind: 'shell', command: cmd || 'command', cwd }
  }
  // diff
  const path =
    rawDetail && typeof rawDetail === 'object' && rawDetail !== null && 'path' in rawDetail
      ? String((rawDetail as { path: unknown }).path ?? '')
      : 'file'
  const unified =
    rawDetail && typeof rawDetail === 'object' && rawDetail !== null && 'unifiedDiff' in rawDetail
      ? String((rawDetail as { unifiedDiff: unknown }).unifiedDiff ?? '')
      : undefined
  return { kind: 'diff', path, unifiedDiff: unified }
}

export function decisionToCodexApproval(
  decision: import('@wanda/agent-protocol').Decision,
): import('./protocol.ts').ApprovalDecision {
  if (decision.behaviour === 'deny') {
    return 'decline'
  }
  // allow
  if (decision.scope === 'always' || decision.scope === 'session') return 'acceptForSession'
  return 'accept'
}

// --- item shape helpers -------------------------------------------------------

function codexItemToToolKind(item: CodexItem): ToolKind {
  switch (item.type) {
    case 'fileChange':
      return 'edit'
    case 'webSearch':
      return 'search'
    case 'commandExecution': {
      const hasTerminal = 'processId' in item && (item as { processId?: unknown }).processId != null
      return hasTerminal ? 'terminal' : 'execute'
    }
    case 'mcpToolCall':
      return 'other'
    default:
      return 'other'
  }
}

function codexItemDefaultTitle(item: CodexItem): string {
  if (item.type === 'commandExecution') {
    const cmd = (item as { command?: unknown }).command
    return typeof cmd === 'string' && cmd.length > 0 ? cmd : 'Shell command'
  }
  if (item.type === 'fileChange') {
    const path = (item as { path?: unknown }).path
    return typeof path === 'string' ? `Edit ${path}` : 'File change'
  }
  if (item.type === 'mcpToolCall') {
    const server = (item as { server?: unknown }).server
    const tool = (item as { tool?: unknown }).tool
    return typeof tool === 'string' ? `mcp/${typeof server === 'string' ? server : 'unknown'}/${tool}` : 'MCP tool'
  }
  if (item.type === 'webSearch') {
    const q = (item as { query?: unknown }).query
    return typeof q === 'string' ? `Search: ${q}` : 'Web search'
  }
  return item.type
}

function codexItemStartDetail(item: CodexItem, kind: ToolKind): import('@wanda/agent-protocol').ToolCallDetail {
  if (kind === 'edit') {
    const path = (item as { path?: unknown }).path
    const unified = (item as { unifiedDiff?: unknown }).unifiedDiff
    return {
      kind: 'diff',
      path: typeof path === 'string' ? path : 'file',
      unifiedDiff: typeof unified === 'string' ? unified : undefined,
    }
  }
  if (kind === 'terminal') {
    const rawLabel = (item as { label?: unknown }).label
    return {
      kind: 'terminal',
      terminalId: item.id,
      label: typeof rawLabel === 'string' ? rawLabel : undefined,
    }
  }
  if (kind === 'execute') {
    const cmd = (item as { command?: unknown }).command
    const cwd = (item as { cwd?: unknown }).cwd
    return {
      kind: 'shell',
      command: typeof cmd === 'string' && cmd.length > 0 ? cmd : 'codex command',
      cwd: typeof cwd === 'string' ? cwd : undefined,
    }
  }
  if (kind === 'search') {
    const q = (item as { query?: unknown }).query
    return {
      kind: 'search',
      query: typeof q === 'string' && q.length > 0 ? q : 'search',
      isRegex: false,
    }
  }
  return { kind: 'other', toolName: item.type, payload: item }
}

type ToolCompletedResult = Extract<AgentEvent, { kind: 'tool.completed' }>['result']

function codexItemResult(item: CodexItem): ToolCompletedResult {
  const raw = (item as { outputSummary?: unknown }).outputSummary
  if (typeof raw === 'string' && raw.length > 0) return { summary: raw }
  return undefined
}

function mapPlanEntry(entry: CodexPlanEntry, index: number): PlanItem {
  const status: PlanItem['status'] =
    entry.status === 'completed' ? 'completed' : entry.status === 'in_progress' ? 'in_progress' : 'pending'
  return {
    id: `plan-${index}` as unknown as PlanItem['id'],
    title: entry.content,
    status,
    dependsOn: [],
  }
}
