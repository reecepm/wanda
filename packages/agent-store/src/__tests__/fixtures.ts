// -----------------------------------------------------------------------------
// Shared fixtures for the reducer + store suites. Built against real branded
// ids so the reducer sees the same shapes it would on the wire.
// -----------------------------------------------------------------------------

import type {
  AgentCapabilities,
  AgentEvent,
  MessageId,
  ModeId,
  ModelId,
  ProviderId,
  SessionId,
  TurnId,
} from '@wanda/agent-protocol'
import {
  newMessageId,
  newPlanItemId,
  newQuestionId,
  newRequestId,
  newSessionId,
  newToolCallId,
  newTurnId,
} from '@wanda/agent-protocol'

export interface FixtureIds {
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly messageId: MessageId
  readonly reasoningMessageId: MessageId
  readonly toolCallId: string
  readonly requestId: string
  readonly questionId: string
  readonly planItemId: string
  readonly providerId: ProviderId
  readonly modeId: ModeId
  readonly modelId: ModelId
}

export function makeIds(): FixtureIds {
  return {
    sessionId: newSessionId(),
    turnId: newTurnId(),
    messageId: newMessageId(),
    reasoningMessageId: newMessageId(),
    toolCallId: newToolCallId(),
    requestId: newRequestId(),
    questionId: newQuestionId(),
    planItemId: newPlanItemId(),
    providerId: 'mock' as ProviderId,
    modeId: 'ask' as ModeId,
    modelId: 'm-1' as ModelId,
  }
}

export const DEFAULT_CAPABILITIES: AgentCapabilities = {
  protocolVersion: '1.0',
  supportsPlanMode: true,
  supportsAutoMode: false,
  supportsReasoning: true,
  supportsToolInvocations: true,
  supportsDiffs: true,
  supportsTerminalBlocks: false,
  supportsImages: false,
  supportsSessionResume: true,
  supportsMcpServers: false,
  supportsElicitation: true,
  modes: [],
  modelOptions: [],
  extensions: {},
}

/** Build a complete happy-path turn timeline for reducer tests. */
export function happyPathTimeline(ids: FixtureIds): AgentEvent[] {
  return [
    {
      kind: 'session.started',
      sessionId: ids.sessionId,
      providerId: ids.providerId,
      capabilities: DEFAULT_CAPABILITIES,
      modes: [],
      modelOptions: [],
      currentModeId: ids.modeId,
      modelId: ids.modelId,
    },
    { kind: 'turn.started', sessionId: ids.sessionId, turnId: ids.turnId },
    {
      kind: 'text.completed',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      messageId: ids.messageId,
      text: 'hello world',
    },
    {
      kind: 'turn.completed',
      sessionId: ids.sessionId,
      turnId: ids.turnId,
      stopReason: 'end_turn',
    },
  ]
}

/** Wrap a plain event list with monotonic seqs starting at `fromSeq`. */
export function withSeqs(events: ReadonlyArray<AgentEvent>, fromSeq = 1): Array<{ seq: number; payload: AgentEvent }> {
  return events.map((e, i) => ({ seq: fromSeq + i, payload: e }))
}
