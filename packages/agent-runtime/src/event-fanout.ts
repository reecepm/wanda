// -----------------------------------------------------------------------------
// Event fanout — single funnel from the runtime to SubscriptionManager +
// EventLog. Implements the live-only delta split from 04 §4.
//
// `emit` is deliberately non-Effect so the hot path (one text.delta every
// 20–50 ms) doesn't pay the fiber-spawn tax. Providers call this directly
// from their emit callbacks.
// -----------------------------------------------------------------------------

import {
  AGENT_SESSION_EVENT_CHANNEL,
  type AgentEvent,
  type AgentEventEnvelope,
  CURRENT_EVENT_SCHEMA_VERSION,
  type SessionId,
} from '@wanda/agent-protocol'
import type { EventLog } from '@wanda/event-log'
import type { SubscriptionManager } from '@wanda/subscriptions'
import { type Envelope, PROTOCOL_VERSION } from '@wanda/wire'
import type { SessionStore } from './session-store.ts'

/** Kinds that never persist — deltas only flow to live subscribers. */
const DELTA_KINDS: ReadonlySet<AgentEvent['kind']> = new Set(['text.delta', 'reasoning.delta'])

export interface EventFanoutDeps {
  readonly eventLog: EventLog
  readonly subscriptions: SubscriptionManager
  /**
   * Optional: after a persisted emit, bump `last_event_seq` + `last_event_at`
   * on the session row so the session-list UI can sort by activity without
   * scanning the event log.
   */
  readonly sessionStore?: SessionStore
  readonly now?: () => number
  readonly logger?: (message: string, ctx?: unknown) => void
}

/**
 * Result of a single emission. `seq: 0` marks a transient emission — either
 * the event was a delta (live-only by design) or the event-log write failed
 * and we degraded. Callers that need to correlate a persisted event with its
 * log row (e.g. pending-permissions bookkeeping) should skip when seq is 0.
 */
export interface EmitRecord {
  readonly seq: number
  readonly ts: number
}

export interface EventFanout {
  /**
   * Publish a single event. Persisted kinds hit the event-log first; on
   * success the real seq flows out through the SubscriptionManager envelope.
   * Delta kinds skip the log entirely (04 §4).
   */
  readonly emit: (sessionId: SessionId, event: AgentEvent) => EmitRecord
  /**
   * Publish multiple events atomically via `eventLog.publishBatch`. Deltas
   * in the batch are rejected — batching is for lifecycle/tool events.
   */
  readonly emitBatch: (sessionId: SessionId, events: ReadonlyArray<AgentEvent>) => ReadonlyArray<EmitRecord>
}

const defaultLogger = (message: string, ctx?: unknown): void => {
  // eslint-disable-next-line no-console
  console.error(`[agent-runtime/fanout] ${message}`, ctx ?? '')
}

export function makeEventFanout(deps: EventFanoutDeps): EventFanout {
  const now = deps.now ?? Date.now
  const logger = deps.logger ?? defaultLogger
  const store = deps.sessionStore

  const bumpActivity = (sessionId: SessionId, seq: number, ts: number): void => {
    if (!store) return
    try {
      store.updateLastEvent(sessionId, seq, ts)
    } catch (err) {
      logger('sessionStore.updateLastEvent failed', { sessionId, err })
    }
  }

  const buildEnvelope = (event: AgentEvent, seq: number, ts: number): Envelope => {
    const payload: AgentEventEnvelope = {
      schemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
      event,
    }
    return {
      v: PROTOCOL_VERSION,
      seq,
      ts,
      channel: AGENT_SESSION_EVENT_CHANNEL,
      // `seq` is duplicated into args so renderer-side per-session dedup
      // has access to it even after the transport's `fireLocal(channel,
      // ...args)` unwraps the outer envelope (the outer `envelope.seq`
      // drives the global resume cursor, not per-session state).
      args: [{ resourceKind: 'agentSession', resourceId: sessionIdString(event), payload, seq }],
    }
  }

  const publishLive = (event: AgentEvent, sessionId: SessionId, seq: number, ts: number): void => {
    const env = buildEnvelope(event, seq, ts)
    try {
      deps.subscriptions.publishEvent('agent-session', sessionIdStr(sessionId), env)
    } catch (err) {
      logger('subscriptions.publishEvent threw', { sessionId, kind: event.kind, err })
    }
  }

  return {
    emit(sessionId, event) {
      // Surface `error` events in the server log — they land in the event
      // log and reduce client-side into `state.lastError`, but without
      // this line a failed turn is visible only to whoever opened the UI
      // banner. When something breaks mid-turn we want it in the dev
      // terminal so it can be correlated with stderr / RPC traces.
      if (event.kind === 'error') {
        // eslint-disable-next-line no-console
        console.error(`[event-fanout] error event on session ${sessionIdStr(sessionId)}:`, {
          message: (event as { message?: string }).message,
          code: (event as { code?: string }).code,
          recoverable: (event as { recoverable?: boolean }).recoverable,
        })
      }
      if (DELTA_KINDS.has(event.kind)) {
        // Live-only: seq=0 marks transient; consumers route deltas to the
        // streaming atom before the dedup check so the synthetic seq is fine.
        const ts = now()
        publishLive(event, sessionId, 0, ts)
        return { seq: 0, ts }
      }

      try {
        const record = deps.eventLog.publish(AGENT_SESSION_EVENT_CHANNEL, 'agentSession', sessionIdStr(sessionId), {
          schemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
          event,
        } satisfies AgentEventEnvelope)
        publishLive(event, sessionId, record.seq, record.ts)
        bumpActivity(sessionId, record.seq, record.ts)
        return { seq: record.seq, ts: record.ts }
      } catch (err) {
        // On eventLog failure (e.g. disk-full read-only mode) degrade to
        // live-only. Clients that reconnect later will see the gap via
        // `too-old` replay.
        logger('eventLog.publish failed; degrading to live-only', {
          sessionId,
          kind: event.kind,
          err,
        })
        const ts = now()
        publishLive(event, sessionId, 0, ts)
        return { seq: 0, ts }
      }
    },

    emitBatch(sessionId, events) {
      if (events.length === 0) return []
      if (events.some((e) => DELTA_KINDS.has(e.kind))) {
        throw new Error('emitBatch: delta events are not batchable (live-only by design)')
      }
      try {
        const records = deps.eventLog.publishBatch(
          events.map((event) => ({
            channel: AGENT_SESSION_EVENT_CHANNEL,
            resourceKind: 'agentSession',
            resourceId: sessionIdStr(sessionId),
            payload: { schemaVersion: CURRENT_EVENT_SCHEMA_VERSION, event } satisfies AgentEventEnvelope,
          })),
        )
        const out: EmitRecord[] = new Array(events.length)
        for (let i = 0; i < events.length; i++) {
          publishLive(events[i]!, sessionId, records[i]!.seq, records[i]!.ts)
          out[i] = { seq: records[i]!.seq, ts: records[i]!.ts }
        }
        const last = records[records.length - 1]
        if (last) bumpActivity(sessionId, last.seq, last.ts)
        return out
      } catch (err) {
        logger('eventLog.publishBatch failed; degrading to live-only', {
          sessionId,
          kinds: events.map((e) => e.kind),
          err,
        })
        const ts = now()
        const out: EmitRecord[] = new Array(events.length)
        for (let i = 0; i < events.length; i++) {
          publishLive(events[i]!, sessionId, 0, ts)
          out[i] = { seq: 0, ts }
        }
        return out
      }
    },
  }
}

// --- helpers ------------------------------------------------------------------

function sessionIdStr(id: SessionId): string {
  return id as unknown as string
}

function sessionIdString(event: AgentEvent): string {
  return sessionIdStr(event.sessionId)
}
