// -----------------------------------------------------------------------------
// Scripted in-process provider for tests, Storybook, and the runtime's
// lifecycle suite. Deterministic; no subprocess.
//
// The mock does not wire into the persistence store — its `persistenceHandle`
// is opaque and ignored on resume. Subscription/event-log glue is the
// runtime's concern, not the provider's: the mock just calls `emit(event)`.
// -----------------------------------------------------------------------------

import {
  type AgentCapabilities,
  type AgentMode,
  type ModeId,
  type ModelOption,
  newMessageId,
  newToolCallId,
  type PermissionRequest,
  type PlanItem,
  type ProviderId,
  type QuestionOption,
  type StopReason,
  type ToolKind,
} from '@wanda/agent-protocol'
import * as Effect from 'effect/Effect'
import type { AgentProvider, AgentSession, SpawnContext, TurnContext } from './types.ts'

export type MockStep =
  | { readonly kind: 'text'; readonly text: string; readonly chunkSize?: number; readonly delayMs?: number }
  | { readonly kind: 'reasoning'; readonly text: string; readonly chunkSize?: number; readonly delayMs?: number }
  | {
      readonly kind: 'tool'
      readonly toolKind: ToolKind
      readonly title: string
      readonly outcome: 'completed' | 'failed' | 'cancelled'
    }
  | {
      readonly kind: 'permission'
      readonly request: PermissionRequest
      /** Timeout handed to `awaitPermission`. */
      readonly timeoutMs?: number
    }
  | { readonly kind: 'plan'; readonly plan: ReadonlyArray<PlanItem> }
  | { readonly kind: 'stopReason'; readonly reason: StopReason }

export interface MockScript {
  readonly steps: ReadonlyArray<MockStep>
  readonly capabilities?: Partial<AgentCapabilities>
  readonly modes?: ReadonlyArray<AgentMode>
  readonly modelOptions?: ReadonlyArray<ModelOption>
}

const DEFAULT_CAPABILITIES: AgentCapabilities = {
  protocolVersion: '1.0-mock',
  supportsPlanMode: true,
  supportsAutoMode: false,
  supportsReasoning: true,
  supportsToolInvocations: true,
  supportsDiffs: true,
  supportsTerminalBlocks: false,
  supportsImages: false,
  supportsSessionResume: true,
  supportsMcpServers: false,
  supportsReview: false,
  supportsElicitation: true,
  modes: [],
  modelOptions: [],
  extensions: {},
}

const DEFAULT_MODES: ReadonlyArray<AgentMode> = [
  { id: 'ask' as ModeId, label: 'Ask', colorTier: 'safe', allowsToolExecution: false },
  { id: 'plan' as ModeId, label: 'Plan', colorTier: 'planning', allowsToolExecution: false },
  { id: 'auto' as ModeId, label: 'Auto', colorTier: 'moderate', allowsToolExecution: true },
]

const DEFAULT_SCRIPT: MockScript = {
  steps: [
    { kind: 'text', text: 'mock response' },
    { kind: 'stopReason', reason: 'end_turn' },
  ],
}

/**
 * Build a mock `AgentProvider`. Pass a script to drive specific sequences;
 * the default replies "mock response" and stops.
 */
export function mockProvider(script: MockScript = DEFAULT_SCRIPT): AgentProvider {
  const resolvedCaps: AgentCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...script.capabilities,
    modes: script.modes ? [...script.modes] : [...DEFAULT_MODES],
    modelOptions: script.modelOptions ? [...script.modelOptions] : [],
  }
  const modes = script.modes ?? DEFAULT_MODES

  const buildSession = (ctx: SpawnContext): AgentSession => ({
    capabilities: resolvedCaps,
    modes,
    modelOptions: script.modelOptions ?? [],
    currentModeId: ctx.modeId ?? null,
    currentModelId: ctx.modelId ?? null,
    currentReasoningEffort: ctx.reasoningEffort ?? null,
    persistenceHandle: { variant: 'mock', handle: ctx.sessionId as string },
    prompt: (turnCtx, _content) => runScript(script.steps, turnCtx),
    setMode: () => Effect.void,
    setModel: () => Effect.void,
    setReasoningEffort: () => Effect.void,
    stderrSnapshot: () => '',
  })

  return {
    manifest: {
      id: 'mock' as ProviderId,
      label: 'Mock Agent',
      kind: 'mock',
      staticCapabilities: {
        supportsSessionResume: true,
        supportsMcpServers: false,
        requiresApiKey: false,
        requiresLogin: false,
        desktopOnly: false,
      },
    },
    detect: () => Effect.succeed({ available: true, version: '0.0.0-mock' }),
    spawn: (ctx) => Effect.succeed(buildSession(ctx)),
    resume: (ctx) => Effect.succeed(buildSession(ctx)),
  }
}

function runScript(steps: ReadonlyArray<MockStep>, ctx: TurnContext): Effect.Effect<{ stopReason: StopReason }, never> {
  return Effect.gen(function* () {
    let stopReason: StopReason = 'end_turn'
    for (const step of steps) {
      if (ctx.signal.aborted) {
        return { stopReason: 'cancelled' as StopReason }
      }
      const outcome = yield* runStep(step, ctx)
      if (outcome.stopReason != null) {
        stopReason = outcome.stopReason
        break
      }
    }
    return { stopReason }
  })
}

function runStep(step: MockStep, ctx: TurnContext): Effect.Effect<{ stopReason?: StopReason }, never> {
  return Effect.gen(function* () {
    switch (step.kind) {
      case 'text': {
        const messageId = newMessageId()
        const chunks = chunkText(step.text, step.chunkSize ?? 10)
        let index = 0
        for (const chunk of chunks) {
          if (step.delayMs) yield* Effect.sleep(`${step.delayMs} millis`)
          ctx.emit({
            kind: 'text.delta',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            messageId,
            text: chunk,
            index,
          })
          index += 1
        }
        ctx.emit({
          kind: 'text.completed',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          messageId,
          text: step.text,
        })
        return {}
      }
      case 'reasoning': {
        const messageId = newMessageId()
        const chunks = chunkText(step.text, step.chunkSize ?? 20)
        let index = 0
        for (const chunk of chunks) {
          if (step.delayMs) yield* Effect.sleep(`${step.delayMs} millis`)
          ctx.emit({
            kind: 'reasoning.delta',
            sessionId: ctx.sessionId,
            turnId: ctx.turnId,
            messageId,
            text: chunk,
            index,
          })
          index += 1
        }
        ctx.emit({
          kind: 'reasoning.completed',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          messageId,
          text: step.text,
        })
        return {}
      }
      case 'tool': {
        const toolCallId = newToolCallId()
        ctx.emit({
          kind: 'tool.started',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          toolCallId,
          toolKind: step.toolKind,
          title: step.title,
        })
        ctx.emit({
          kind: 'tool.completed',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          toolCallId,
          status: step.outcome,
        })
        return {}
      }
      case 'permission': {
        // Delegate end-to-end to the TurnContext bridge: it generates the
        // requestId, registers the pending Deferred, emits the request/
        // resolved events, and awaits the user's decision. The mock must
        // not emit these events itself (double-emission with mismatched
        // requestIds would break respondPermission lookup).
        yield* Effect.promise(() => ctx.awaitPermission(step.request, step.timeoutMs))
        return {}
      }
      case 'plan': {
        ctx.emit({
          kind: 'plan.updated',
          sessionId: ctx.sessionId,
          turnId: ctx.turnId,
          plan: [...step.plan],
        })
        return {}
      }
      case 'stopReason': {
        return { stopReason: step.reason }
      }
    }
  })
}

function chunkText(text: string, size: number): string[] {
  if (size <= 0) return [text]
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) {
    out.push(text.slice(i, i + size))
  }
  return out.length > 0 ? out : [text]
}

// Re-export a typed helper so test authors can build QuestionOption inline
// without fishing through the protocol package.
export type { QuestionOption }
