// -----------------------------------------------------------------------------
// Domain types for permission_policies. Mirrors the row shape so call sites
// don't have to know about Drizzle.
// -----------------------------------------------------------------------------

import type { ToolKind } from '@wanda/agent-protocol'

/**
 * Either the exact `ToolKind` enum, or `'*'` meaning "match all kinds".
 * The DB column accepts both; we widen the type at the boundary.
 */
export type ToolKindOrAny = ToolKind | '*'

export type PermissionPolicyDecision = { behaviour: 'allow' } | { behaviour: 'deny'; message?: string }

export interface PermissionPolicyRow {
  readonly id: string
  readonly workspaceId: string
  readonly providerId: string
  readonly toolKind: ToolKindOrAny
  readonly toolName: string
  readonly locationPattern: string
  readonly decision: PermissionPolicyDecision
  readonly createdBySessionId: string | null
  readonly expiresAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PermissionPolicyInsert {
  readonly workspaceId: string
  readonly providerId: string
  readonly toolKind: ToolKindOrAny
  readonly toolName?: string
  readonly locationPattern?: string
  readonly decision: PermissionPolicyDecision
  readonly createdBySessionId?: string | null
  readonly expiresAt?: number | null
}
