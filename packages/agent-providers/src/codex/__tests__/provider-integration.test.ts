// -----------------------------------------------------------------------------
// End-to-end integration tests for the Codex direct provider.
//
// Uses a `_testTransport` option to swap the subprocess spawn for a pair
// of in-memory `PassThrough` streams driven by a scripted fake Codex
// server. Covers the acquire handshake (initialize / model/list /
// collaborationMode/list / account/read / thread/start) plus the specific
// regressions fixed in the ui-centric-agents branch:
//
//   * thread/start returning a null/missing threadId must surface as a
//     non-recoverable AgentProviderError instead of silently binding
//     `undefined` and letting turn/start explode later.
//   * A transport that closes before the handshake completes must fail
//     the acquire promise rather than hang forever.
// -----------------------------------------------------------------------------

import { PassThrough } from 'node:stream'
import {
  type AgentEvent,
  type Decision,
  type ModeId,
  type ModelId,
  newSessionId,
  newTurnId,
  type PermissionRequest,
  type QuestionAnswer,
} from '@wanda/agent-protocol'
import type { TurnContext } from '@wanda/agent-runtime'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { codexDirectProvider } from '../provider.ts'

interface FakeCodexOpts {
  /** Value to return for `thread/start.result.threadId`. Defaults to a
   *  non-empty string so tests exercise the happy path by default. Pass
   *  `null` to exercise the silent-undefined regression. */
  readonly threadId?: string | null
  /** If true, close stdout after all scripted responses to simulate a
   *  subprocess that exited cleanly mid-session. */
  readonly closeAfterHandshake?: boolean
  readonly models?: ReadonlyArray<{
    id: string
    model?: string
    displayName?: string
    isDefault?: boolean
    supportedReasoningEfforts?: ReadonlyArray<string | { readonly reasoningEffort?: string }>
    defaultReasoningEffort?: string
  }>
  readonly modelListShape?: 'models' | 'data'
}

function makeFakeCodex(opts: FakeCodexOpts = {}) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const received: Array<Record<string, unknown>> = []
  const threadId = opts.threadId === undefined ? 'thr_test_happy' : opts.threadId

  const send = (frame: Record<string, unknown>): void => {
    stdout.write(`${JSON.stringify(frame)}\n`)
  }

  const handleFrame = (frame: Record<string, unknown>): void => {
    received.push(frame)
    if (typeof frame.method !== 'string' || frame.id === undefined) return
    const id = frame.id
    switch (frame.method) {
      case 'initialize':
        send({ jsonrpc: '2.0', id, result: { userAgent: 'fake-codex/0.0.0' } })
        return
      case 'model/list': {
        const models = opts.models ?? [
          { id: 'gpt-5', displayName: 'GPT-5', isDefault: true },
          { id: 'gpt-5-mini', displayName: 'GPT-5 Mini' },
        ]
        const key = opts.modelListShape === 'data' ? 'data' : 'models'
        send({
          jsonrpc: '2.0',
          id,
          result: { [key]: models },
        })
        return
      }
      case 'collaborationMode/list':
        send({ jsonrpc: '2.0', id, result: { collaborationModes: [] } })
        return
      case 'account/read':
        send({ jsonrpc: '2.0', id, result: { account: { type: 'apiKey' } } })
        return
      case 'thread/start': {
        const requestedModel = (frame.params as { model?: unknown } | undefined)?.model
        // Codex 0.104+ shape: thread metadata is nested under `thread`.
        send({
          jsonrpc: '2.0',
          id,
          result:
            threadId === null
              ? { thread: { id: null } }
              : {
                  thread: {
                    id: threadId,
                    cwd: '/tmp',
                    createdAt: 0,
                    updatedAt: 0,
                    preview: '',
                    modelProvider: 'openai',
                    cliVersion: '0.104.0',
                    source: 'appServer',
                    turns: [],
                  },
                  approvalPolicy: 'on-request',
                  cwd: '/tmp',
                  model: typeof requestedModel === 'string' ? requestedModel : 'gpt-5',
                  modelProvider: 'openai',
                  sandbox: { type: 'workspaceWrite' },
                },
        })
        if (opts.closeAfterHandshake) setImmediate(() => stdout.end())
        return
      }
      case 'thread/resume':
        send({
          jsonrpc: '2.0',
          id,
          result: { thread: { id: threadId ?? 'thr_resumed' } },
        })
        return
      default:
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32_601, message: `not mocked: ${String(frame.method)}` },
        })
    }
  }

  let buf = ''
  stdin.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let idx = buf.indexOf('\n')
    while (idx !== -1) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line.length > 0) {
        try {
          handleFrame(JSON.parse(line) as Record<string, unknown>)
        } catch {
          /* malformed frame — test failure will surface through assertions */
        }
      }
      idx = buf.indexOf('\n')
    }
  })

  return {
    transport: {
      stdin,
      stdout,
      stderrSnapshot: () => '',
    },
    received,
  }
}

function makePromptFakeCodex(
  script: (args: { send: (frame: Record<string, unknown>) => void; threadId: string; turnId: string }) => void,
  opts: {
    readonly models?: ReadonlyArray<{
      id: string
      model?: string
      displayName?: string
      isDefault?: boolean
      supportedReasoningEfforts?: ReadonlyArray<string | { readonly reasoningEffort?: string }>
      defaultReasoningEffort?: string
    }>
    readonly modelListShape?: 'models' | 'data'
    readonly rejectNewerCodexModels?: boolean
  } = {},
) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const received: Array<Record<string, unknown>> = []
  const threadId = 'thr_prompt'
  let turnCount = 0

  const send = (frame: Record<string, unknown>): void => {
    stdout.write(`${JSON.stringify(frame)}\n`)
  }

  const handleFrame = (frame: Record<string, unknown>): void => {
    received.push(frame)
    if (typeof frame.method !== 'string' || frame.id === undefined) return
    const id = frame.id
    switch (frame.method) {
      case 'initialize':
        send({ jsonrpc: '2.0', id, result: { userAgent: 'fake-codex/0.0.0' } })
        return
      case 'model/list': {
        const key = opts.modelListShape === 'data' ? 'data' : 'models'
        send({
          jsonrpc: '2.0',
          id,
          result: { [key]: opts.models ?? [{ id: 'gpt-5', displayName: 'GPT-5', isDefault: true }] },
        })
        return
      }
      case 'collaborationMode/list':
        send({ jsonrpc: '2.0', id, result: { collaborationModes: [] } })
        return
      case 'account/read':
        send({ jsonrpc: '2.0', id, result: { account: { type: 'apiKey' } } })
        return
      case 'thread/start': {
        const requestedModel = (frame.params as { model?: unknown } | undefined)?.model
        send({
          jsonrpc: '2.0',
          id,
          result: {
            thread: { id: threadId, cwd: '/tmp', createdAt: 0, updatedAt: 0, preview: '' },
            model: typeof requestedModel === 'string' ? requestedModel : 'gpt-5',
          },
        })
        return
      }
      case 'turn/start': {
        const requestedModel = (frame.params as { model?: unknown } | undefined)?.model
        if (opts.rejectNewerCodexModels && requestedModel === 'gpt-5.5') {
          send({
            jsonrpc: '2.0',
            method: 'error',
            params: {
              threadId,
              error: {
                message:
                  '{"detail":"The \'gpt-5.5\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}',
              },
            },
          })
          send({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32_000,
              message:
                '{"detail":"The \'gpt-5.5\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}',
            },
          })
          return
        }
        turnCount += 1
        const turnId = `codex-turn-${turnCount}`
        send({ jsonrpc: '2.0', id, result: { turn: { id: turnId } } })
        setImmediate(() => script({ send, threadId, turnId }))
        return
      }
      case 'turn/interrupt':
        send({ jsonrpc: '2.0', id, result: { interrupted: true } })
        return
      default:
        send({
          jsonrpc: '2.0',
          id,
          error: { code: -32_601, message: `not mocked: ${String(frame.method)}` },
        })
    }
  }

  let buf = ''
  stdin.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let idx = buf.indexOf('\n')
    while (idx !== -1) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line.length > 0) {
        handleFrame(JSON.parse(line) as Record<string, unknown>)
      }
      idx = buf.indexOf('\n')
    }
  })

  return {
    transport: {
      stdin,
      stdout,
      stderrSnapshot: () => '',
    },
    received,
  }
}

function makeCtx(): { ctx: TurnContext; emitted: AgentEvent[] } {
  const emitted: AgentEvent[] = []
  const ctx: TurnContext = {
    sessionId: newSessionId(),
    turnId: newTurnId(),
    emit: (event) => emitted.push(event),
    awaitPermission: async (_req: PermissionRequest) => ({ behaviour: 'allow', scope: 'once' }) satisfies Decision,
    awaitQuestion: async () => ({ kind: 'freeform', text: 'ok' }) satisfies QuestionAnswer,
    signal: new AbortController().signal,
  }
  return { ctx, emitted }
}

const baseSpawnCtx = () => ({
  sessionId: newSessionId(),
  cwd: '/tmp/wanda-test',
  env: {} as Record<string, string>,
  workspaceId: null,
})

describe('codexDirectProvider (integration)', () => {
  it('completes the handshake and materialises an AgentSession', async () => {
    const { transport, received } = makeFakeCodex({ threadId: 'thr_happy' })
    const provider = codexDirectProvider({ _testTransport: transport })

    const session = await Effect.runPromise(Effect.scoped(provider.spawn(baseSpawnCtx())))

    expect(session.capabilities.protocolVersion).toBe('1.0-codex')
    expect(session.modelOptions.map((m) => m.id)).toEqual(['gpt-5', 'gpt-5-mini'])
    expect(session.modelOptions.find((m) => m.isDefault)?.id).toBe('gpt-5')
    expect(session.modes.length).toBeGreaterThan(0)
    // threadId is opaque through the handle but must be persisted on it.
    // The handle's `threadId` field is the flattened extraction we do
    // server-side — the wire shape is `{ thread: { id } }`, the handle
    // stores just the id string so future thread/resume calls can pass
    // it back as `threadId`.
    expect((session.persistenceHandle as { threadId?: string }).threadId).toBe('thr_happy')

    // Sanity: we actually called the full handshake sequence.
    const methods = received.map((f) => f.method).filter((m): m is string => typeof m === 'string')
    expect(methods).toEqual(
      expect.arrayContaining([
        'initialize',
        'initialized',
        'model/list',
        'collaborationMode/list',
        'account/read',
        'thread/start',
      ]),
    )
  })

  it('advertises gpt-5.5 after the bundled Codex bump', async () => {
    const { transport, received } = makeFakeCodex({
      threadId: 'thr_model_filter',
      models: [
        { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true },
        { id: 'gpt-5', displayName: 'GPT-5' },
      ],
    })
    const provider = codexDirectProvider({ _testTransport: transport })

    const session = await Effect.runPromise(
      Effect.scoped(
        provider.spawn({
          ...baseSpawnCtx(),
          modelId: 'gpt-5.5' as ModelId,
        }),
      ),
    )

    expect(session.modelOptions.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5'])
    expect(session.currentModelId).toBe('gpt-5.5')
    const threadStart = received.find((frame) => frame.method === 'thread/start') as
      | { params?: { model?: string } }
      | undefined
    expect(threadStart?.params?.model).toBe('gpt-5.5')
  })

  it('reads the current Codex model/list data shape', async () => {
    const { transport } = makeFakeCodex({
      threadId: 'thr_model_data_shape',
      modelListShape: 'data',
      models: [
        {
          id: 'gpt-5.4',
          displayName: 'GPT-5.4',
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }],
          defaultReasoningEffort: 'medium',
        },
        { id: 'gpt-5.3-codex', displayName: 'GPT-5.3-Codex' },
      ],
    })
    const provider = codexDirectProvider({ _testTransport: transport })

    const session = await Effect.runPromise(Effect.scoped(provider.spawn(baseSpawnCtx())))

    expect(session.modelOptions.map((m) => m.id)).toEqual(['gpt-5.4', 'gpt-5.3-codex'])
    expect(session.modelOptions[0]?.supportedReasoningEfforts).toEqual(['medium', 'high'])
    expect(session.currentModelId).toBe('gpt-5.4')
  })

  it('passes selected reasoning effort to turn/start', async () => {
    const { transport, received } = makePromptFakeCodex(
      ({ send, threadId, turnId }) => {
        send({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'completed' } },
        })
      },
      {
        models: [
          {
            id: 'gpt-5',
            displayName: 'GPT-5',
            isDefault: true,
            supportedReasoningEfforts: ['minimal', 'low', 'medium', 'high'],
            defaultReasoningEffort: 'medium',
          },
        ],
      },
    )
    const provider = codexDirectProvider({ _testTransport: transport })
    const currentReasoningEffort = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn({
            ...baseSpawnCtx(),
            reasoningEffort: 'high',
          })
          const { ctx } = makeCtx()
          yield* session.prompt(ctx, [{ kind: 'text', text: 'reason harder' }])
          return session.currentReasoningEffort
        }),
      ),
    )

    const turnStart = received.find((frame) => frame.method === 'turn/start') as
      | { params?: { effort?: string } }
      | undefined
    expect(currentReasoningEffort).toBe('high')
    expect(turnStart?.params?.effort).toBe('high')
  })

  it('routes auto-review mode approvals through Codex auto_review reviewer', async () => {
    const { transport, received } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn({
            ...baseSpawnCtx(),
            modeId: 'auto-review' as ModeId,
          })
          const { ctx } = makeCtx()
          yield* session.prompt(ctx, [{ kind: 'text', text: 'run tests' }])
        }),
      ),
    )

    const threadStart = received.find((frame) => frame.method === 'thread/start') as
      | { params?: { approvalPolicy?: string; approvalsReviewer?: string } }
      | undefined
    const turnStart = received.find((frame) => frame.method === 'turn/start') as
      | { params?: { approvalPolicy?: string; approvalsReviewer?: string } }
      | undefined
    expect(threadStart?.params?.approvalPolicy).toBe('untrusted')
    expect(threadStart?.params?.approvalsReviewer).toBe('auto_review')
    expect(turnStart?.params?.approvalPolicy).toBe('untrusted')
    expect(turnStart?.params?.approvalsReviewer).toBe('auto_review')
  })

  it('fails acquire with a non-recoverable error when thread/start returns null threadId', async () => {
    const { transport } = makeFakeCodex({ threadId: null })
    const provider = codexDirectProvider({ _testTransport: transport })

    await expect(Effect.runPromise(Effect.scoped(provider.spawn(baseSpawnCtx())))).rejects.toThrow(
      /thread\/start|threadId/,
    )
  })

  it('fails acquire when thread/start returns a missing threadId field', async () => {
    // Separate fake that omits threadId entirely — exercises the `r?.threadId`
    // optional-chain path distinct from the explicit `null` case above.
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    let buf = ''
    stdin.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let idx = buf.indexOf('\n')
      while (idx !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        idx = buf.indexOf('\n')
        if (line.length === 0) continue
        const frame = JSON.parse(line) as { id?: unknown; method?: string }
        if (frame.method === 'initialize') {
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} })}\n`)
        } else if (frame.method === 'model/list') {
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { models: [] } })}\n`)
        } else if (frame.method === 'collaborationMode/list') {
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { collaborationModes: [] } })}\n`)
        } else if (frame.method === 'account/read') {
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} })}\n`)
        } else if (frame.method === 'thread/start') {
          // Empty result — no `thread` field at all. Zod parse should fail.
          stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: {} })}\n`)
        }
      }
    })

    const provider = codexDirectProvider({
      _testTransport: { stdin, stdout, stderrSnapshot: () => '' },
    })

    await expect(Effect.runPromise(Effect.scoped(provider.spawn(baseSpawnCtx())))).rejects.toThrow(
      /thread\/start|threadId/,
    )
  })

  it('ignores stale notifications from a different Codex turn id', async () => {
    const { transport } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          threadId,
          turnId: 'codex-turn-stale',
          item: { id: 'tool-stale', type: 'commandExecution', command: 'echo stale' },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          threadId,
          turnId,
          item: { id: 'msg-1', type: 'assistantMessage' },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'item/agentMessage/delta',
        params: { threadId, turnId, itemId: 'msg-1', delta: 'live text' },
      })
      send({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: { id: 'msg-1', type: 'assistantMessage' },
          status: 'completed',
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })
    const { result, emitted } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn(baseSpawnCtx())
          const { ctx, emitted } = makeCtx()
          const result = yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          return { result, emitted }
        }),
      ),
    )

    expect(result.stopReason).toBe('end_turn')
    expect(emitted.some((event) => event.kind === 'tool.started' && event.title === 'echo stale')).toBe(false)
    expect(emitted.some((event) => event.kind === 'text.completed' && event.text === 'live text')).toBe(true)
  })

  it('emits assistant text from rawResponseItem/completed notifications', async () => {
    const { transport } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        jsonrpc: '2.0',
        method: 'rawResponseItem/completed',
        params: {
          threadId,
          turnId,
          item: {
            id: 'response-msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'raw codex response' }],
          },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })
    const { result, emitted } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn(baseSpawnCtx())
          const { ctx, emitted } = makeCtx()
          const result = yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          return { result, emitted }
        }),
      ),
    )

    expect(result.stopReason).toBe('end_turn')
    expect(emitted.some((event) => event.kind === 'text.completed' && event.text === 'raw codex response')).toBe(true)
  })

  it('emits assistant text from newer agentMessage item/completed notifications', async () => {
    const { transport } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        jsonrpc: '2.0',
        method: 'item/started',
        params: {
          threadId,
          turnId,
          item: { id: 'msg-agent-1', type: 'agentMessage', text: '' },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'item/completed',
        params: {
          threadId,
          turnId,
          item: { id: 'msg-agent-1', type: 'agentMessage', text: 'agent item response' },
          status: 'completed',
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })
    const { emitted } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn(baseSpawnCtx())
          const { ctx, emitted } = makeCtx()
          yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          return { emitted }
        }),
      ),
    )

    expect(emitted.some((event) => event.kind === 'text.completed' && event.text === 'agent item response')).toBe(true)
  })

  it('emits assistant text from turn/completed item snapshots', async () => {
    const { transport } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {
          threadId,
          turn: {
            id: turnId,
            status: 'completed',
            items: [
              { id: 'user-1', type: 'userMessage' },
              { id: 'msg-agent-2', type: 'agentMessage', text: 'snapshot response' },
            ],
          },
        },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })
    const { emitted } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn(baseSpawnCtx())
          const { ctx, emitted } = makeCtx()
          yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          return { emitted }
        }),
      ),
    )

    expect(emitted.some((event) => event.kind === 'text.completed' && event.text === 'snapshot response')).toBe(true)
  })

  it('falls back when Codex rejects a selected model as requiring a newer version', async () => {
    const { transport, received } = makePromptFakeCodex(
      ({ send, threadId, turnId }) => {
        send({
          jsonrpc: '2.0',
          method: 'turn/started',
          params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
        })
        send({
          jsonrpc: '2.0',
          method: 'rawResponseItem/completed',
          params: {
            threadId,
            turnId,
            item: {
              id: 'response-msg-1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'safe model response' }],
            },
          },
        })
        send({
          jsonrpc: '2.0',
          method: 'turn/completed',
          params: { threadId, turn: { id: turnId, status: 'completed' } },
        })
      },
      {
        models: [
          { id: 'gpt-5.5', displayName: 'GPT-5.5', isDefault: true },
          { id: 'gpt-5', displayName: 'GPT-5' },
        ],
        rejectNewerCodexModels: true,
      },
    )
    const provider = codexDirectProvider({ _testTransport: transport })
    const { emitted } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* provider.spawn({
            ...baseSpawnCtx(),
            modelId: 'gpt-5.5' as ModelId,
          })
          const { ctx, emitted } = makeCtx()
          yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          return { emitted }
        }),
      ),
    )

    const turnStarts = received.filter((frame) => frame.method === 'turn/start') as Array<{
      params?: { model?: string }
    }>
    expect(turnStarts.map((frame) => frame.params?.model)).toEqual(['gpt-5.5', 'gpt-5'])
    expect(emitted.some((event) => event.kind === 'error')).toBe(false)
    expect(emitted.some((event) => event.kind === 'text.completed' && event.text === 'safe model response')).toBe(true)
  })

  it('rejects prompt when Codex reports turn failure', async () => {
    const { transport } = makePromptFakeCodex(({ send, threadId, turnId }) => {
      send({
        jsonrpc: '2.0',
        method: 'turn/started',
        params: { threadId, turn: { id: turnId, status: 'inProgress', items: [] } },
      })
      send({
        jsonrpc: '2.0',
        method: 'error',
        params: {
          threadId,
          turnId,
          willRetry: false,
          error: {
            message: 'boom',
            code: 'EFAIL',
          },
        },
      })
      send({
        jsonrpc: '2.0',
        method: 'turn/completed',
        params: {
          threadId,
          turn: {
            id: turnId,
            status: 'failed',
            error: { message: 'boom', code: 'EFAIL' },
          },
        },
      })
    })
    const provider = codexDirectProvider({ _testTransport: transport })
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const session = yield* provider.spawn(baseSpawnCtx())
            const { ctx } = makeCtx()
            return yield* session.prompt(ctx, [{ kind: 'text', text: 'hi' }])
          }),
        ),
      ),
    ).rejects.toThrow(/boom/)
  })
})
