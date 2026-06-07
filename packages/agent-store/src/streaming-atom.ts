// -----------------------------------------------------------------------------
// Per-session streaming atom for text.delta / reasoning.delta.
//
// Separate from the durable store so every delta doesn't shallow-copy
// `state.messages`. Subscribers get a flush per animation frame regardless
// of delta arrival rate (smooths > 60/s token streams).
// -----------------------------------------------------------------------------

import type { MessageId, SessionId } from '@wanda/agent-protocol'

export type StreamKind = 'text' | 'reasoning'

export interface StreamingPart {
  readonly sessionId: SessionId
  readonly messageId: MessageId
  readonly kind: StreamKind
  readonly text: string
  /** Monotonic per-message ordinal from the delta event; used for drop detection. */
  readonly lastIndex: number
  readonly firstDeltaAt: number
  readonly lastDeltaAt: number
}

type Listener = () => void

function streamKey(messageId: MessageId, kind: StreamKind): string {
  return `${messageId}|${kind}`
}

/**
 * On `*.completed` the atom entry is disposed and the durable reducer takes
 * over. Multiple atoms can coexist if the provider emits reasoning + text
 * in parallel (keyed by `(messageId, kind)`).
 */
export class StreamingAtom {
  private parts = new Map<string, StreamingPart>()
  private listeners = new Set<Listener>()
  private pendingFlush = false

  snapshot(): ReadonlyMap<string, StreamingPart> {
    return this.parts
  }

  snapshotKey(messageId: MessageId, kind: StreamKind): StreamingPart | undefined {
    return this.parts.get(streamKey(messageId, kind))
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  appendDelta(input: {
    sessionId: SessionId
    messageId: MessageId
    kind: StreamKind
    text: string
    index: number
    ts: number
  }): void {
    const key = streamKey(input.messageId, input.kind)
    const prev = this.parts.get(key)
    const next: StreamingPart = prev
      ? {
          ...prev,
          text: prev.text + input.text,
          lastIndex: input.index,
          lastDeltaAt: input.ts,
        }
      : {
          sessionId: input.sessionId,
          messageId: input.messageId,
          kind: input.kind,
          text: input.text,
          lastIndex: input.index,
          firstDeltaAt: input.ts,
          lastDeltaAt: input.ts,
        }
    this.parts.set(key, next)
    this.scheduleFlush()
  }

  complete(messageId: MessageId, kind: StreamKind): void {
    const key = streamKey(messageId, kind)
    if (!this.parts.has(key)) return
    this.parts.delete(key)
    this.scheduleFlush()
  }

  clear(): void {
    if (this.parts.size === 0) return
    this.parts.clear()
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.pendingFlush) return
    this.pendingFlush = true
    const raf =
      typeof globalThis.requestAnimationFrame === 'function'
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : (fn: FrameRequestCallback) => setTimeout(() => fn(Date.now()), 16)
    raf(() => {
      this.pendingFlush = false
      // Snapshot listeners so a handler can unsubscribe mid-flush without
      // skipping remaining listeners.
      const snapshot = [...this.listeners]
      for (const listener of snapshot) {
        try {
          listener()
        } catch (err) {
          // Never break the flush loop. Surface for debugging, continue.
          // eslint-disable-next-line no-console
          console.error('[agent-store] streaming listener threw', err)
        }
      }
    })
  }

  /** Test-only synchronous flush; bypasses the rAF scheduler. */
  flushNow(): void {
    this.pendingFlush = false
    const snapshot = [...this.listeners]
    for (const listener of snapshot) {
      try {
        listener()
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[agent-store] streaming listener threw', err)
      }
    }
  }
}
