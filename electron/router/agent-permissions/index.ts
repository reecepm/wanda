// -----------------------------------------------------------------------------
// `agent.permissions.*` oRPC procedures.
//
// Renderer-facing surface for the persisted permission policies the user
// saved via `scope: 'always'` decisions (or will later author directly in a
// settings pane).
// -----------------------------------------------------------------------------

import { ORPCError } from '@orpc/client'
import type { PermissionPolicy, PermissionPolicyBehaviour } from '@wanda/agent-protocol'
import { Effect } from 'effect'
import { z } from 'zod'
import { PermissionPolicyStore } from '../../domains/permission-policy'
import { WorkspaceController } from '../../services'
import type { AppRouterDeps } from '../index'

const ListPoliciesInput = z.object({ workspaceId: z.string().min(1) })
const RevokePolicyInput = z.object({ policyId: z.string().min(1) })

export function agentPermissionRoutes({ effectOs }: AppRouterDeps) {
  return {
    listPolicies: effectOs.input(ListPoliciesInput).effect(function* ({ input }) {
      const workspaces = yield* WorkspaceController
      const workspace = yield* workspaces.getById(input.workspaceId)
      if (!workspace) {
        return yield* Effect.fail(
          new ORPCError('WORKSPACE_NOT_FOUND', {
            message: `Workspace ${input.workspaceId} not found`,
          }),
        )
      }
      const store = yield* PermissionPolicyStore
      const rows = yield* store.listByWorkspace(input.workspaceId)
      const out: PermissionPolicy[] = rows.map((r) => {
        const behaviour: PermissionPolicyBehaviour = r.decision.behaviour === 'allow' ? 'allow' : 'deny'
        return {
          policyId: r.id,
          workspaceId: r.workspaceId,
          providerId: r.providerId,
          toolKind: r.toolKind as string,
          toolName: r.toolName,
          locationPattern: r.locationPattern,
          behaviour,
          denyMessage: r.decision.behaviour === 'deny' ? r.decision.message : undefined,
          expiresAt: r.expiresAt,
          createdAt: r.createdAt,
        }
      })
      return out
    }),

    revokePolicy: effectOs.input(RevokePolicyInput).effect(function* ({ input }) {
      const store = yield* PermissionPolicyStore
      const removed = yield* store.delete(input.policyId)
      if (!removed) {
        return yield* Effect.fail(
          new ORPCError('POLICY_NOT_FOUND', {
            message: `Permission policy ${input.policyId} not found`,
          }),
        )
      }
      return { revoked: true }
    }),
  }
}
