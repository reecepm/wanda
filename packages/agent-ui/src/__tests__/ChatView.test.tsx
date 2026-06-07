// -----------------------------------------------------------------------------
// End-to-end React rendering tests driving a ChatView against a scripted
// AgentEvent timeline. No real transport — a stub implements the same
// surface and replays events into the store.
// -----------------------------------------------------------------------------

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  type AgentCapabilities,
  type AgentEvent,
  type Decision,
  newMessageId,
  newRequestId,
  newSessionId,
  newToolCallId,
  newTurnId,
  type PromptBlock,
  type QuestionAnswer,
  type SessionId,
} from '@wanda/agent-protocol'
import type { ChatStoreHandle } from '@wanda/agent-store'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '../ChatView'
import { AgentUIProvider, type AgentUITransport } from '../context'
import { installDefaultToolRenderers } from '../tools/DefaultToolRenderers'
import { clearToolRegistry } from '../tools/registry'

installDefaultToolRenderers()

interface Harness {
  readonly transport: AgentUITransport
  readonly stores: Map<SessionId, ChatStoreHandle>
  readonly calls: {
    prompt: Array<{ sessionId: SessionId; content: ReadonlyArray<PromptBlock> }>
    respondPermission: Array<{ sessionId: SessionId; requestId: string; decision: Decision }>
    respondQuestion: Array<{ sessionId: SessionId; questionId: string; answer: QuestionAnswer }>
  }
}

function makeHarness(): Harness {
  const stores = new Map<SessionId, ChatStoreHandle>()
  const calls: Harness['calls'] = {
    prompt: [],
    respondPermission: [],
    respondQuestion: [],
  }
  const transport: AgentUITransport = {
    createSession: vi.fn(async () => ({ sessionId: newSessionId() })),
    prompt: vi.fn(async (input) => {
      calls.prompt.push({ sessionId: input.sessionId, content: input.content })
      return { turnId: newTurnId() as unknown as string }
    }),
    cancel: vi.fn(async () => ({ cancelled: true })),
    respondPermission: vi.fn(async (input) => {
      calls.respondPermission.push(input)
      return { accepted: true }
    }),
    respondQuestion: vi.fn(async (input) => {
      calls.respondQuestion.push(input)
      return { accepted: true }
    }),
    close: vi.fn(async () => ({ closed: true })),
    subscribeToSession: () => () => {},
  }
  return { transport, stores, calls }
}

function Provider({ harness, children }: { harness: Harness; children: ReactNode }) {
  return (
    <AgentUIProvider
      transport={harness.transport}
      onStoreCreated={(sessionId, store) => {
        harness.stores.set(sessionId, store)
      }}
    >
      {children}
    </AgentUIProvider>
  )
}

let seq = 0

function push(harness: Harness, sessionId: SessionId, event: AgentEvent): void {
  const store = harness.stores.get(sessionId)
  if (!store) throw new Error(`no store for ${String(sessionId)}`)
  seq += 1
  act(() => store.applyLiveEvent(event, seq))
}

const BASIC_CAPS: AgentCapabilities = {
  protocolVersion: '1.0',
  supportsPlanMode: false,
  supportsAutoMode: false,
  supportsReasoning: false,
  supportsToolInvocations: true,
  supportsDiffs: false,
  supportsTerminalBlocks: false,
  supportsImages: false,
  supportsSessionResume: false,
  supportsMcpServers: false,
  supportsElicitation: true,
  supportsReview: false,
  modes: [],
  modelOptions: [],
  extensions: {},
}

describe('ChatView', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    seq = 0
    clearToolRegistry()
    installDefaultToolRenderers()
  })

  it('renders session.started + text.completed', () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    const turnId = newTurnId()
    const messageId = newMessageId()
    push(harness, sessionId, {
      kind: 'session.started',
      sessionId,
      providerId: 'mock' as never,
      capabilities: BASIC_CAPS,
      modes: [],
      modelOptions: [],
    })
    push(harness, sessionId, { kind: 'turn.started', sessionId, turnId })
    push(harness, sessionId, {
      kind: 'text.completed',
      sessionId,
      turnId,
      messageId,
      text: 'hello world',
    })
    push(harness, sessionId, {
      kind: 'turn.completed',
      sessionId,
      turnId,
      stopReason: 'end_turn',
    })
    expect(screen.getByText('hello world')).toBeDefined()
  })

  it('submits through the composer via transport.prompt', async () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    push(harness, sessionId, {
      kind: 'session.started',
      sessionId,
      providerId: 'mock' as never,
      capabilities: BASIC_CAPS,
      modes: [],
      modelOptions: [],
    })
    const textarea = screen.getByPlaceholderText('Ask the agent…') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hi there' } })
    fireEvent.submit(textarea.closest('form')!)
    await act(async () => {
      await Promise.resolve()
    })
    expect(harness.calls.prompt).toHaveLength(1)
    expect(harness.calls.prompt[0]!.content).toEqual([{ kind: 'text', text: 'hi there' }])
    expect(screen.getByText('hi there')).toBeDefined()
  })

  it('does not submit while the session is still starting', async () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    const textarea = screen.getByPlaceholderText('Connecting to agent…') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'hi too early' } })
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.submit(textarea.closest('form')!)
    await act(async () => {
      await Promise.resolve()
    })
    expect(harness.calls.prompt).toHaveLength(0)
    expect(textarea.value).toBe('hi too early')
  })

  it('renders a permission card and calls respondPermission on click', async () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    push(harness, sessionId, {
      kind: 'session.started',
      sessionId,
      providerId: 'mock' as never,
      capabilities: BASIC_CAPS,
      modes: [],
      modelOptions: [],
    })
    const turnId = newTurnId()
    push(harness, sessionId, { kind: 'turn.started', sessionId, turnId })
    const requestId = newRequestId()
    push(harness, sessionId, {
      kind: 'permission.requested',
      sessionId,
      turnId,
      requestId,
      request: {
        kind: 'tool',
        toolCallId: newToolCallId(),
        title: 'Run rm -rf',
        detail: { kind: 'shell', command: 'rm -rf /tmp/foo' },
      },
    })
    fireEvent.click(screen.getByText('Allow once'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(harness.calls.respondPermission).toHaveLength(1)
    expect(harness.calls.respondPermission[0]!.decision).toEqual({
      behaviour: 'allow',
      scope: 'once',
    })
  })

  it('renders a tool-execute part via the default registry', () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    const turnId = newTurnId()
    push(harness, sessionId, { kind: 'turn.started', sessionId, turnId })
    const toolCallId = newToolCallId()
    push(harness, sessionId, {
      kind: 'tool.started',
      sessionId,
      turnId,
      toolCallId,
      toolKind: 'execute',
      title: 'run tests',
      detail: { kind: 'shell', command: 'bun run test' },
    })
    push(harness, sessionId, {
      kind: 'tool.completed',
      sessionId,
      turnId,
      toolCallId,
      status: 'completed',
    })
    expect(screen.getByText('run tests')).toBeDefined()
    // The command appears both in the row subtitle and the expanded body,
    // so the row is rendering twice — subtitle + CodeInk inside the body.
    expect(screen.getAllByText('bun run test').length).toBeGreaterThan(0)
  })

  it('commits text.completed into durable messages', () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    const turnId = newTurnId()
    const messageId = newMessageId()
    push(harness, sessionId, { kind: 'turn.started', sessionId, turnId })
    push(harness, sessionId, {
      kind: 'text.completed',
      sessionId,
      turnId,
      messageId,
      text: 'final text',
    })
    expect(screen.getByText('final text')).toBeDefined()
  })

  it('renders streaming text before text.completed lands', () => {
    const harness = makeHarness()
    const sessionId = newSessionId()
    render(
      <Provider harness={harness}>
        <ChatView sessionId={sessionId} />
      </Provider>,
    )
    const turnId = newTurnId()
    const messageId = newMessageId()
    push(harness, sessionId, {
      kind: 'session.started',
      sessionId,
      providerId: 'mock' as never,
      capabilities: BASIC_CAPS,
      modes: [],
      modelOptions: [],
    })
    push(harness, sessionId, { kind: 'turn.started', sessionId, turnId })
    push(harness, sessionId, {
      kind: 'text.delta',
      sessionId,
      turnId,
      messageId,
      text: 'hello',
      index: 0,
    })
    expect(screen.getByText('hello')).toBeDefined()
  })
})
