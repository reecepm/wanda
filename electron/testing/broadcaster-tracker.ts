// -----------------------------------------------------------------------------
// makeTestBroadcasterLayer — drop-in Broadcaster replacement that records
// every send() call so tests can assert on emitted events without wiring up
// the WS gateway.
//
// Mirrors the `make<Service>Layer()` -> `{ layer, tracker }` convention
// used throughout `electron/services/__tests__/test-layer.ts`. Lives here
// (not in test-layer.ts) so workenv tests can pull the broadcaster
// independently of the legacy v1 environment layer wiring.
// -----------------------------------------------------------------------------

import { Layer } from 'effect'
import type { AppEventArgs, AppEventChannel } from '../../shared/contracts/events'
import { Broadcaster, type BroadcasterShape } from '../infra/broadcaster'

export interface BroadcasterSendRecord {
  readonly channel: string
  readonly args: readonly unknown[]
}

export interface BroadcasterTracker {
  readonly sends: BroadcasterSendRecord[]
  /** All recorded args tuples for `channel`, in send order. */
  sendsOn<K extends AppEventChannel>(channel: K): AppEventArgs<K>[]
  /** The most recently recorded args tuple for `channel`, or undefined. */
  lastOn<K extends AppEventChannel>(channel: K): AppEventArgs<K> | undefined
  /** Reset all recorded sends. */
  clear(): void
}

export function makeTestBroadcasterLayer(): {
  layer: Layer.Layer<Broadcaster>
  tracker: BroadcasterTracker
} {
  const sends: BroadcasterSendRecord[] = []
  const tracker: BroadcasterTracker = {
    sends,
    sendsOn: (channel) => sends.filter((r) => r.channel === channel).map((r) => r.args as never),
    lastOn: (channel) => {
      for (let i = sends.length - 1; i >= 0; i--) {
        const r = sends[i]
        if (r && r.channel === channel) return r.args as never
      }
      return undefined
    },
    clear: () => {
      sends.length = 0
    },
  }
  const layer = Layer.sync(
    Broadcaster,
    (): BroadcasterShape => ({
      send: (channel, ...args) => {
        sends.push({ channel, args })
      },
    }),
  )
  return { layer, tracker }
}
