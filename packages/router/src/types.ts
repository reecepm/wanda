// -----------------------------------------------------------------------------
// Public types for @wanda/router.
// -----------------------------------------------------------------------------

import type { AnyResourceRef } from '@wanda/wire'

export interface PairedServer {
  /** Local opaque handle that consumer code passes around. */
  readonly registryId: string
  /** Server-declared identity from hello-ack. Detects stale pairings. */
  readonly serverId: string
  /** HTTP base URL; may be updated by port-heal flows. */
  readonly baseUrl: string
  readonly label: string
  readonly pairedAt: number
}

export interface OutboxEntry {
  readonly id: string
  readonly idempotencyKey: string
  readonly method: string
  readonly input: unknown
  readonly ref: AnyResourceRef | null
  readonly createdAt: number
  readonly retries: number
  readonly lastError: string | null
}

export interface Mutation {
  readonly method: string
  readonly input: unknown
  readonly ref?: AnyResourceRef | null
}
