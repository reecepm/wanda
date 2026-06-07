// -----------------------------------------------------------------------------
// Codex notification → Wanda AgentEvent translation. Verifies the shape
// + the per-turn state machine (tool started/updated/completed, message
// deltas coalescing into text.completed, etc.).
// -----------------------------------------------------------------------------

import type { AgentEvent, SessionId, TurnId } from '@wanda/agent-protocol'
import { newSessionId, newTurnId } from '@wanda/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  buildApprovalPermissionRequest,
  type CodexTurnContext,
  decisionToCodexApproval,
  makeTurnBuffers,
  onAgentMessageDelta,
  onCommandExecOutputDelta,
  onError,
  onItemCompleted,
  onItemStarted,
  onPlanUpdated,
  onRawResponseItemCompleted,
  onReasoningDelta,
  onTurnCompleted,
  onTurnCompletedItems,
} from '../mapper.ts'

function mkCtx(): { ctx: CodexTurnContext; events: AgentEvent[] } {
  const events: AgentEvent[] = []
  const ctx: CodexTurnContext = {
    sessionId: newSessionId() as SessionId,
    turnId: newTurnId() as TurnId,
    emit: (e) => events.push(e),
  }
  return { ctx, events }
}

describe('codex mapper', () => {
  it('assistantMessage: item/started + agentMessage/delta + item/completed → text.delta × n + text.completed', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()

    onItemStarted(ctx, buf, {
      threadId: 't1',
      turnId: 'tr1',
      item: { id: 'i1', type: 'assistantMessage' },
    })
    onAgentMessageDelta(ctx, buf, {
      threadId: 't1',
      turnId: 'tr1',
      itemId: 'i1',
      delta: 'Hello',
    })
    onAgentMessageDelta(ctx, buf, {
      threadId: 't1',
      turnId: 'tr1',
      itemId: 'i1',
      delta: ' world',
    })
    onItemCompleted(ctx, buf, {
      threadId: 't1',
      turnId: 'tr1',
      item: { id: 'i1', type: 'assistantMessage' },
    })

    expect(events.map((e) => e.kind)).toEqual(['text.delta', 'text.delta', 'text.completed'])
    const completed = events[2] as Extract<AgentEvent, { kind: 'text.completed' }>
    expect(completed.text).toBe('Hello world')
  })

  it('reasoning: textDelta → reasoning.delta + completed', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()
    onItemStarted(ctx, buf, { threadId: 't', turnId: 'tr', item: { id: 'r1', type: 'reasoning' } })
    onReasoningDelta(ctx, buf, { threadId: 't', turnId: 'tr', itemId: 'r1', delta: 'think' })
    onItemCompleted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'r1', type: 'reasoning' },
    })
    const kinds = events.map((e) => e.kind)
    expect(kinds).toEqual(['reasoning.delta', 'reasoning.completed'])
  })

  it('rawResponseItem/completed message output maps to assistant text.completed', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()

    onRawResponseItemCompleted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: {
        id: 'raw-1',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'Hello ' },
          { type: 'output_text', text: 'from raw response' },
        ],
      },
    })

    expect(events.map((e) => e.kind)).toEqual(['text.completed'])
    const completed = events[0] as Extract<AgentEvent, { kind: 'text.completed' }>
    expect(completed.text).toBe('Hello from raw response')
  })

  it('rawResponseItem/completed reuses an existing assistant message id when item ids match', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()

    onItemStarted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'msg-1', type: 'assistantMessage' },
    })
    onAgentMessageDelta(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      itemId: 'msg-1',
      delta: 'partial',
    })
    const delta = events[0] as Extract<AgentEvent, { kind: 'text.delta' }>

    onRawResponseItemCompleted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'complete text' }],
      },
    })

    const completed = events[1] as Extract<AgentEvent, { kind: 'text.completed' }>
    expect(completed.messageId).toBe(delta.messageId)
    expect(completed.text).toBe('complete text')
  })

  it('agentMessage item/completed maps completed item text to assistant text.completed', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()

    onItemStarted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'msg-2', type: 'agentMessage', text: '' },
    })
    onItemCompleted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'msg-2', type: 'agentMessage', text: 'new codex text' },
      status: 'completed',
    })

    expect(events.map((e) => e.kind)).toEqual(['text.completed'])
    const completed = events[0] as Extract<AgentEvent, { kind: 'text.completed' }>
    expect(completed.text).toBe('new codex text')
  })

  it('turn/completed snapshots can commit agentMessage items when item/completed was not emitted', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()

    onTurnCompletedItems(ctx, buf, {
      threadId: 't',
      turn: {
        id: 'tr',
        status: 'completed',
        items: [
          { id: 'user-1', type: 'userMessage' },
          { id: 'msg-3', type: 'agentMessage', text: 'snapshot text' },
        ],
      },
    })

    expect(events.map((e) => e.kind)).toEqual(['text.completed'])
    const completed = events[0] as Extract<AgentEvent, { kind: 'text.completed' }>
    expect(completed.text).toBe('snapshot text')
  })

  it('commandExecution item → tool.started + tool.completed with shell detail', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()
    onItemStarted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'cmd1', type: 'commandExecution', command: 'ls -la', cwd: '/tmp' },
    })
    onItemCompleted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      status: 'completed',
      item: { id: 'cmd1', type: 'commandExecution' },
    })
    const kinds = events.map((e) => e.kind)
    expect(kinds).toEqual(['tool.started', 'tool.completed'])
    const started = events[0] as Extract<AgentEvent, { kind: 'tool.started' }>
    expect(started.toolKind).toBe('execute')
    expect(started.detail).toMatchObject({ kind: 'shell', command: 'ls -la', cwd: '/tmp' })
    const completed = events[1] as Extract<AgentEvent, { kind: 'tool.completed' }>
    expect(completed.status).toBe('completed')
  })

  it('item/commandExecution/outputDelta appends plain-text deltas into tool.updated', () => {
    // Codex 0.104 wire format: `delta` is plain UTF-8, no base64, no
    // stdout/stderr discriminator. See protocol.ts CommandExecOutputDeltaNotification.
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()
    onItemStarted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: { id: 'cmd2', type: 'commandExecution', command: 'echo hi' },
    })
    onCommandExecOutputDelta(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      itemId: 'cmd2',
      delta: 'hello ',
    })
    onCommandExecOutputDelta(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      itemId: 'cmd2',
      delta: 'world',
    })
    const updates = events.filter((e) => e.kind === 'tool.updated') as Array<
      Extract<AgentEvent, { kind: 'tool.updated' }>
    >
    expect(updates).toHaveLength(2)
    expect((updates[1].detail as { payload: { stdout: string } }).payload.stdout).toBe('hello world')
  })

  it('fileChange item with unified diff maps to tool with diff detail', () => {
    const { ctx, events } = mkCtx()
    const buf = makeTurnBuffers()
    onItemStarted(ctx, buf, {
      threadId: 't',
      turnId: 'tr',
      item: {
        id: 'f1',
        type: 'fileChange',
        path: 'src/x.ts',
        unifiedDiff: '@@ -1,1 +1,1 @@\n-old\n+new\n',
      },
    })
    const started = events[0] as Extract<AgentEvent, { kind: 'tool.started' }>
    expect(started.toolKind).toBe('edit')
    expect(started.detail).toMatchObject({ kind: 'diff', path: 'src/x.ts' })
  })

  it('turn/completed cancelled/failed/normal map to turn.cancelled/error/turn.completed', () => {
    const { ctx, events: evA } = mkCtx()
    onTurnCompleted(ctx, { threadId: 't', turn: { id: 'tr', status: 'canceled' } })
    expect(evA[0]?.kind).toBe('turn.cancelled')

    const { ctx: ctxB, events: evB } = mkCtx()
    onTurnCompleted(ctxB, {
      threadId: 't',
      turn: { id: 'tr', status: 'failed', error: { message: 'boom' } },
    })
    expect(evB[0]?.kind).toBe('error')

    const { ctx: ctxC, events: evC } = mkCtx()
    onTurnCompleted(ctxC, { threadId: 't', turn: { id: 'tr', status: 'completed' } })
    expect(evC[0]?.kind).toBe('turn.completed')
  })

  it('plan/updated maps to plan.updated with mapped entries', () => {
    const { ctx, events } = mkCtx()
    onPlanUpdated(ctx, {
      threadId: 't',
      turnId: 'tr',
      plan: [
        { content: 'step 1', status: 'completed' },
        { content: 'step 2', status: 'in_progress' },
        { content: 'step 3', status: 'pending' },
      ],
    })
    const e = events[0] as Extract<AgentEvent, { kind: 'plan.updated' }>
    expect(e.plan.map((p) => p.status)).toEqual(['completed', 'in_progress', 'pending'])
  })

  it('error notification maps nested Codex errors to error events', () => {
    const { ctx, events } = mkCtx()
    onError(ctx, {
      error: { message: 'server broke', code: 'ECONN' },
      willRetry: true,
    })
    const e = events[0] as Extract<AgentEvent, { kind: 'error' }>
    expect(e.message).toBe('server broke')
    expect(e.recoverable).toBe(true)
    expect(e.code).toBe('ECONN')
  })

  it('buildApprovalPermissionRequest yields allow/session/deny actions with the right scopes', () => {
    const built = buildApprovalPermissionRequest('shell', {
      threadId: 't',
      turnId: 'tr',
      itemId: 'i',
      detail: { command: 'rm -rf /tmp/x' },
    })
    const scopes = built.actions.map((a) => `${a.behaviour}:${a.scope}`)
    expect(scopes).toEqual(['allow:once', 'allow:session', 'deny:once'])
    expect(built.detail).toMatchObject({ kind: 'shell', command: 'rm -rf /tmp/x' })
  })

  it('decisionToCodexApproval maps scope correctly', () => {
    expect(decisionToCodexApproval({ behaviour: 'allow', scope: 'once' })).toBe('accept')
    expect(decisionToCodexApproval({ behaviour: 'allow', scope: 'session' })).toBe('acceptForSession')
    expect(decisionToCodexApproval({ behaviour: 'deny', scope: 'once' })).toBe('decline')
  })
})
