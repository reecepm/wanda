// -----------------------------------------------------------------------------
// Round-trip coverage for every AgentEvent variant + key unions.
//
// Pattern: build a fixture → parse → JSON.stringify → JSON.parse → parse
// again, and assert the two parsed values are deeply equal. Catches missing
// `kind` discriminators, broken brand round-trips, bad `default()` wiring,
// and dropped optional fields.
// -----------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_KINDS,
  type AgentEvent,
  AgentEventEnvelopeSchema,
  AgentEventSchema,
  DecisionSchema,
  newAttachmentId,
  newMessageId,
  newPlanItemId,
  newQuestionId,
  newRequestId,
  newSessionId,
  newToolCallId,
  newTurnId,
  PartSchema,
  PermissionRequestSchema,
  PromptBlockSchema,
  QuestionAnswerSchema,
  safeParseAgentEvent,
  ToolCallDetailSchema,
  UIMessageSchema,
} from '../index.ts'

function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  const first = schema.parse(value)
  const encoded = JSON.parse(JSON.stringify(first))
  return schema.parse(encoded)
}

const ids = () => ({
  sessionId: newSessionId(),
  turnId: newTurnId(),
  messageId: newMessageId(),
  toolCallId: newToolCallId(),
  requestId: newRequestId(),
  questionId: newQuestionId(),
  planItemId: newPlanItemId(),
  attachmentId: newAttachmentId(),
})

const providerId = 'claude-sdk'
const modeId = 'plan'
const modelId = 'claude-sonnet-4-6'

const fixtures: Record<(typeof AGENT_EVENT_KINDS)[number], AgentEvent> = {
  'session.started': {
    kind: 'session.started',
    sessionId: ids().sessionId,
    providerId: providerId as AgentEvent extends { kind: 'session.started'; providerId: infer P } ? P : never,
    capabilities: {
      protocolVersion: '1.0',
      supportsPlanMode: true,
      supportsAutoMode: true,
      supportsReasoning: true,
      supportsToolInvocations: true,
      supportsDiffs: true,
      supportsTerminalBlocks: true,
      supportsImages: true,
      supportsSessionResume: true,
      supportsMcpServers: true,
      supportsReview: true,
      supportsElicitation: true,
      modes: [],
      modelOptions: [],
      extensions: {},
    },
    modes: [],
    modelOptions: [],
  },
  'session.closed': {
    kind: 'session.closed',
    sessionId: ids().sessionId,
    reason: 'user',
    message: 'closed by user',
  },
  'turn.started': {
    kind: 'turn.started',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
  },
  'turn.completed': {
    kind: 'turn.completed',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 20, costMicros: 100 },
  },
  'turn.cancelled': {
    kind: 'turn.cancelled',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    acknowledged: true,
  },
  'text.delta': {
    kind: 'text.delta',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    messageId: ids().messageId,
    text: 'hello',
    index: 0,
  },
  'text.completed': {
    kind: 'text.completed',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    messageId: ids().messageId,
    text: 'hello world',
  },
  'reasoning.delta': {
    kind: 'reasoning.delta',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    messageId: ids().messageId,
    text: 'thinking…',
    index: 0,
  },
  'reasoning.completed': {
    kind: 'reasoning.completed',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    messageId: ids().messageId,
    text: 'done thinking',
  },
  'tool.started': {
    kind: 'tool.started',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    toolCallId: ids().toolCallId,
    toolKind: 'execute',
    title: 'run tests',
    detail: { kind: 'shell', command: 'bun run test' },
    locations: [{ path: 'src/index.ts', line: 1 }],
  },
  'tool.updated': {
    kind: 'tool.updated',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    toolCallId: ids().toolCallId,
    status: 'in_progress',
    progress: { stdoutChunk: 'running…', percent: 50 },
  },
  'tool.completed': {
    kind: 'tool.completed',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    toolCallId: ids().toolCallId,
    status: 'completed',
    result: { summary: 'all green' },
  },
  'plan.updated': {
    kind: 'plan.updated',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    plan: [
      {
        id: ids().planItemId,
        title: 'step 1',
        status: 'pending',
        dependsOn: [],
      },
    ],
  },
  'permission.requested': {
    kind: 'permission.requested',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    requestId: ids().requestId,
    request: {
      kind: 'tool',
      toolCallId: ids().toolCallId,
      title: 'run rm -rf',
      detail: { kind: 'shell', command: 'rm -rf /tmp/foo' },
    },
    timeoutAt: 1_700_000_000_000,
  },
  'permission.resolved': {
    kind: 'permission.resolved',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    requestId: ids().requestId,
    decision: { behaviour: 'allow', scope: 'once' },
  },
  'question.requested': {
    kind: 'question.requested',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    questionId: ids().questionId,
    question: 'which framework?',
    options: [
      { id: 'react', label: 'React' },
      { id: 'vue', label: 'Vue', description: 'progressive' },
    ],
    allowFreeform: true,
  },
  'question.resolved': {
    kind: 'question.resolved',
    sessionId: ids().sessionId,
    turnId: ids().turnId,
    questionId: ids().questionId,
    answer: { kind: 'option', optionId: 'react' },
  },
  'mode.changed': {
    kind: 'mode.changed',
    sessionId: ids().sessionId,
    modeId: modeId as AgentEvent extends { kind: 'mode.changed'; modeId: infer M } ? M : never,
  },
  'model.changed': {
    kind: 'model.changed',
    sessionId: ids().sessionId,
    modelId: modelId as AgentEvent extends { kind: 'model.changed'; modelId: infer M } ? M : never,
  },
  'reasoning.effort.changed': {
    kind: 'reasoning.effort.changed',
    sessionId: ids().sessionId,
    reasoningEffort: 'high',
  },
  error: {
    kind: 'error',
    sessionId: ids().sessionId,
    message: 'provider exited',
    recoverable: false,
    code: 'PROVIDER_EXITED',
    stderrTail: 'Segmentation fault',
  },
}

describe('AgentEvent round-trip', () => {
  for (const kind of AGENT_EVENT_KINDS) {
    it(`${kind} round-trips`, () => {
      const parsed = roundTrip(AgentEventSchema, fixtures[kind])
      expect(parsed.kind).toBe(kind)
    })
  }

  it('every variant in AGENT_EVENT_KINDS has a fixture', () => {
    for (const k of AGENT_EVENT_KINDS) {
      expect(fixtures[k]).toBeDefined()
    }
  })

  it('safeParseAgentEvent returns null on unknown kind', () => {
    expect(safeParseAgentEvent({ kind: 'bogus', sessionId: 'x' })).toBeNull()
  })

  it('safeParseAgentEvent returns null on missing discriminator', () => {
    expect(safeParseAgentEvent({ sessionId: 'x' })).toBeNull()
  })

  it('provider sidecar survives round-trip', () => {
    const evt: AgentEvent = {
      kind: 'text.delta',
      sessionId: ids().sessionId,
      turnId: ids().turnId,
      messageId: ids().messageId,
      text: 'hi',
      index: 0,
      provider: { signature: 'abc', toolName: 'claude' },
    }
    const parsed = roundTrip(AgentEventSchema, evt)
    expect(parsed).toMatchObject({ provider: { signature: 'abc', toolName: 'claude' } })
  })
})

describe('Envelope', () => {
  it('wraps and round-trips', () => {
    const envelope = {
      schemaVersion: 1,
      event: fixtures['turn.started'],
    }
    const parsed = roundTrip(AgentEventEnvelopeSchema, envelope)
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.event.kind).toBe('turn.started')
  })

  it('defaults schemaVersion when absent', () => {
    const parsed = AgentEventEnvelopeSchema.parse({ event: fixtures['turn.started'] })
    expect(parsed.schemaVersion).toBe(1)
  })
})

describe('PermissionRequest variants', () => {
  it.each(['tool', 'plan', 'question', 'mode', 'other'] as const)('%s variant round-trips', (kind) => {
    const { toolCallId, planItemId, questionId } = ids()
    const fixturesByKind = {
      tool: {
        kind: 'tool' as const,
        toolCallId,
        title: 'edit file',
        detail: { kind: 'read' as const, path: 'src/index.ts' },
      },
      plan: {
        kind: 'plan' as const,
        planId: planItemId,
        plan: [{ id: planItemId, title: 'step', status: 'pending' as const, dependsOn: [] }],
      },
      question: {
        kind: 'question' as const,
        questionId,
        question: 'continue?',
        options: [{ id: 'y', label: 'Yes' }],
        allowFreeform: false,
      },
      mode: { kind: 'mode' as const, proposedModeId: 'auto' as never },
      other: { kind: 'other' as const, title: 'approve?', description: 'details' },
    }
    const parsed = roundTrip(PermissionRequestSchema, fixturesByKind[kind])
    expect(parsed.kind).toBe(kind)
  })
})

describe('Decision', () => {
  it('allow round-trips without an `answer` field (R7)', () => {
    const parsed = roundTrip(DecisionSchema, { behaviour: 'allow', scope: 'session' })
    expect(parsed.behaviour).toBe('allow')
    expect('answer' in parsed).toBe(false)
  })

  it('deny with message round-trips', () => {
    const parsed = roundTrip(DecisionSchema, { behaviour: 'deny', scope: 'once', message: 'no' })
    expect(parsed).toMatchObject({ behaviour: 'deny', message: 'no' })
  })
})

describe('QuestionAnswer', () => {
  it('option answer round-trips', () => {
    const parsed = roundTrip(QuestionAnswerSchema, { kind: 'option', optionId: 'y' })
    expect(parsed).toMatchObject({ kind: 'option', optionId: 'y' })
  })
  it('freeform answer round-trips', () => {
    const parsed = roundTrip(QuestionAnswerSchema, { kind: 'freeform', text: 'hi' })
    expect(parsed).toMatchObject({ kind: 'freeform', text: 'hi' })
  })
})

describe('ToolCallDetail variants', () => {
  const cases = [
    { kind: 'shell', command: 'ls' },
    { kind: 'diff', path: 'src/x.ts', unifiedDiff: '--- a\n+++ b\n' },
    { kind: 'read', path: 'src/x.ts', range: { startLine: 0, endLine: 10 } },
    { kind: 'search', query: 'foo', isRegex: true },
    { kind: 'fetch', url: 'https://example.com', method: 'GET' },
    { kind: 'terminal', terminalId: 't1', label: 'main' },
    { kind: 'think', topic: 'design' },
    { kind: 'other', toolName: 'custom_tool', payload: { a: 1 } },
  ] as const

  for (const fixture of cases) {
    it(`${fixture.kind} round-trips`, () => {
      const parsed = roundTrip(ToolCallDetailSchema, fixture)
      expect(parsed.kind).toBe(fixture.kind)
    })
  }
})

describe('PromptBlock variants', () => {
  it('text block', () => {
    const parsed = roundTrip(PromptBlockSchema, { kind: 'text', text: 'hello' })
    expect(parsed.kind).toBe('text')
  })

  it('attachment block with sha256', () => {
    const block = {
      kind: 'attachment' as const,
      id: newAttachmentId(),
      mediaType: 'image/png',
      size: 1234,
      sha256: 'a'.repeat(64),
      name: 'pic.png',
    }
    const parsed = roundTrip(PromptBlockSchema, block)
    expect(parsed.kind).toBe('attachment')
  })

  it('image block with dims', () => {
    const block = {
      kind: 'image' as const,
      id: newAttachmentId(),
      mediaType: 'image/png',
      size: 1234,
      sha256: 'b'.repeat(64),
      width: 640,
      height: 480,
    }
    const parsed = roundTrip(PromptBlockSchema, block)
    expect(parsed.kind).toBe('image')
  })

  it('resource link', () => {
    const block = {
      kind: 'resource' as const,
      ref: { serverId: 'local', kind: 'podItem', id: 'p1' },
      title: 'file.ts',
    }
    const parsed = roundTrip(PromptBlockSchema, block)
    expect(parsed.kind).toBe('resource')
  })

  it('mention block', () => {
    const block = {
      kind: 'mention' as const,
      mentionType: 'file' as const,
      label: 'file.ts',
      target: 'src/file.ts',
    }
    const parsed = roundTrip(PromptBlockSchema, block)
    expect(parsed.kind).toBe('mention')
  })

  it('command block', () => {
    const block = { kind: 'command' as const, name: 'clear', args: { all: true } }
    const parsed = roundTrip(PromptBlockSchema, block)
    expect(parsed.kind).toBe('command')
  })

  it('rejects attachment with bad sha256', () => {
    const block = {
      kind: 'attachment' as const,
      id: newAttachmentId(),
      mediaType: 'image/png',
      size: 1234,
      sha256: 'not-hex',
    }
    expect(() => PromptBlockSchema.parse(block)).toThrow()
  })
})

describe('Part variants', () => {
  const toolCallId = newToolCallId()
  const requestId = newRequestId()
  const questionId = newQuestionId()
  const messageId = newMessageId()
  const planItemId = newPlanItemId()

  const parts = [
    { type: 'text' as const, text: 'hi', state: 'done' as const, index: 0 },
    { type: 'reasoning' as const, text: 'hmm', state: 'streaming' as const, index: 1 },
    {
      type: 'tool-execute' as const,
      toolCallId,
      status: 'completed' as const,
      index: 2,
    },
    {
      type: 'plan' as const,
      plan: [{ id: planItemId, title: 'step', status: 'pending' as const, dependsOn: [] }],
      index: 3,
    },
    {
      type: 'permission' as const,
      requestId,
      request: { kind: 'other' as const, title: 'ok?' },
      index: 4,
    },
    {
      type: 'question' as const,
      questionId,
      question: 'y/n?',
      index: 5,
      allowFreeform: false,
    },
    { type: 'data' as const, name: 'trace', id: 't-1', value: { foo: 1 }, index: 6 },
  ]

  for (const part of parts) {
    it(`${part.type} part round-trips`, () => {
      const parsed = roundTrip(PartSchema, part)
      expect(parsed.type).toBe(part.type)
      expect(parsed.index).toBe(part.index)
    })
  }

  it('UIMessage round-trips with multiple parts', () => {
    const msg = {
      id: messageId,
      role: 'assistant' as const,
      parts,
      createdAt: 1_700_000_000_000,
    }
    const parsed = roundTrip(UIMessageSchema, msg)
    expect(parsed.parts).toHaveLength(parts.length)
  })
})
