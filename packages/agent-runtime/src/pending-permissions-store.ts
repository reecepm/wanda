// -----------------------------------------------------------------------------
// PendingPermissionsStore — durable mirror of outstanding permission prompts.
//
// The runtime pairs each `permission.requested` event with an in-memory
// Deferred (see ManagedSession). Across a server restart that Deferred is
// gone — this store is how we know which prompts were left hanging so a
// boot-time drain can synthesize `deny` for them (spec 02 §3.4).
//
// Interface is sync on purpose (better-sqlite3 is sync). Tests pass the
// in-memory impl; electron provides a Drizzle-backed adapter.
// -----------------------------------------------------------------------------

import type { Decision, PermissionRequest, RequestId, SessionId, TurnId } from '@wanda/agent-protocol'

export interface PendingPermissionRow {
  readonly requestId: RequestId
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly eventSeq: number
  readonly request: PermissionRequest
  readonly createdAt: number
  readonly resolvedAt: number | null
  readonly resolution: Decision | null
}

export interface PendingPermissionsStoreInsert {
  readonly requestId: RequestId
  readonly sessionId: SessionId
  readonly turnId: TurnId
  readonly eventSeq: number
  readonly request: PermissionRequest
}

export interface PendingPermissionsStore {
  readonly insert: (row: PendingPermissionsStoreInsert) => void
  /**
   * Mark a row resolved. Idempotent — a second call for the same id is a
   * no-op so late `permission.resolved` events (after a boot drain already
   * settled the row) don't overwrite the synthetic deny.
   */
  readonly resolve: (requestId: RequestId, decision: Decision) => void
  /** Rows where `resolved_at IS NULL`. Sorted by createdAt ascending. */
  readonly listUnresolved: () => ReadonlyArray<PendingPermissionRow>
}

/** In-memory implementation for tests. */
export function makeInMemoryPendingPermissionsStore(): PendingPermissionsStore {
  const rows = new Map<RequestId, PendingPermissionRow>()
  const now = () => Date.now()
  return {
    insert(input) {
      rows.set(input.requestId, {
        ...input,
        createdAt: now(),
        resolvedAt: null,
        resolution: null,
      })
    },
    resolve(requestId, decision) {
      const existing = rows.get(requestId)
      if (!existing) return
      if (existing.resolvedAt != null) return
      rows.set(requestId, {
        ...existing,
        resolvedAt: now(),
        resolution: decision,
      })
    },
    listUnresolved() {
      const out: PendingPermissionRow[] = []
      for (const row of rows.values()) {
        if (row.resolvedAt == null) out.push(row)
      }
      out.sort((a, b) => a.createdAt - b.createdAt)
      return out
    },
  }
}
