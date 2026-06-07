// -----------------------------------------------------------------------------
// Public types for @wanda/event-log.
// -----------------------------------------------------------------------------

import type { EventChannel, ResourceKind } from '@wanda/wire'
import type { ReplayGoneReason } from './errors.ts'

/** A persisted event row, reconstructed into its in-memory form. */
export interface EventRecord {
  readonly seq: number
  readonly ts: number
  readonly epoch: number
  readonly channel: EventChannel
  readonly resourceKind: ResourceKind
  readonly resourceId: string
  readonly payload: unknown
}

/** Result of a single `replayPage()` call. */
export type ReplayPageResult =
  | {
      readonly ok: true
      readonly events: readonly EventRecord[]
      /** True when this page has fewer rows than `limit` — i.e. caller has reached the tip. */
      readonly done: boolean
      /** The seq of the last row on this page, or sinceSeq if empty. */
      readonly nextCursor: number
    }
  | { readonly ok: false; readonly reason: ReplayGoneReason }

export interface PruneOptions {
  /** Delete rows whose `ts` is older than now - maxAgeMs. */
  readonly maxAgeMs?: number
  /** After max-age, trim oldest rows until total count <= maxRows. */
  readonly maxRows?: number
  /** Scope prune to a single resource kind. Leaves other kinds untouched. */
  readonly resourceKind?: ResourceKind
}

/** Options for the per-resource replay variant. */
export interface ReplayPageByResourceOptions {
  /** Exclusive lower bound on seq. Pass 0 to start from the earliest row. */
  readonly sinceSeq: number
  /** Client's known epoch. Mismatch returns `{ ok: false, reason: 'epoch-mismatch' }`. */
  readonly sinceEpoch: number
  /** Exclusive upper bound on seq. Omitted → no cap (read to tip). */
  readonly upToSeq?: number
  /** Max rows returned per page. Defaults to 1000. */
  readonly limit?: number
  /** Traversal direction. 'forward' = seq ASC; 'backward' = seq DESC. Default forward. */
  readonly direction?: 'forward' | 'backward'
}

/** Options for cold-load per-resource replay across every persisted epoch. */
export interface ReplayPageByResourceAllEpochsOptions {
  /** Exclusive lower bound on global seq. Pass 0 to start from earliest row. */
  readonly sinceSeq: number
  /** Exclusive upper bound on seq. Omitted -> no cap (read to tip). */
  readonly upToSeq?: number
  /** Max rows returned per page. Defaults to 1000. */
  readonly limit?: number
  /** Traversal direction. 'forward' = seq ASC; 'backward' = seq DESC. Default forward. */
  readonly direction?: 'forward' | 'backward'
}

/** Result of `deleteByResource()`. */
export interface DeleteByResourceResult {
  readonly rowsDeleted: number
  /** Smallest seq affected; null if no rows matched. */
  readonly minSeq: number | null
  /** Largest seq affected; null if no rows matched. */
  readonly maxSeq: number | null
}

/** Input row for `publishBatch()`. */
export interface PublishBatchInput {
  readonly channel: EventChannel
  readonly resourceKind: ResourceKind
  readonly resourceId: string
  readonly payload: unknown
}

export interface EventLogHealth {
  readonly status: 'healthy' | 'degraded'
  readonly cause?: string
}

export type HealthListener = (health: EventLogHealth) => void
