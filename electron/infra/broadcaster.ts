import { Context, Layer } from 'effect'

// -----------------------------------------------------------------------------
// Broadcast emitter used by domain services to push typed events to
// connected clients. Transport-agnostic: the shell (or standalone
// server entry) calls `configureBroadcaster(broadcast)` at startup with
// a callback that routes events to the WebSocket gateway, and domain
// code calls `broadcaster.send(channel, ...args)` without caring about
// the underlying wire.
// -----------------------------------------------------------------------------

export interface BroadcasterShape {
  readonly send: (channel: string, ...args: unknown[]) => void
}

export class Broadcaster extends Context.Tag('Broadcaster')<Broadcaster, BroadcasterShape>() {}

type BroadcastFn = (channel: string, ...args: unknown[]) => void

/**
 * Module-level broadcast callback. Set by the shell (or standalone
 * server entry) via `configureBroadcaster` before the runtime resolves
 * the Broadcaster service. Matches the config pattern used by
 * `configureDatabase` and `configureAgentRuntime`.
 */
let broadcastFn: BroadcastFn = () => {
  // Default no-op. Callers that emit before `configureBroadcaster` is
  // invoked will have their events silently dropped; this is only a
  // problem in tests, which supply their own test layer.
}

/**
 * Configure the broadcast callback used by `BroadcasterLive`. Call this
 * before any domain service resolves `Broadcaster`.
 */
export function configureBroadcaster(broadcast: BroadcastFn): void {
  broadcastFn = broadcast
}

/** Live layer: proxies `send` to the configured broadcast callback. */
export const BroadcasterLive = Layer.sync(Broadcaster, () => ({
  send: (channel, ...args) => broadcastFn(channel, ...args),
}))
