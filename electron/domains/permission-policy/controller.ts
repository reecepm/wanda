// -----------------------------------------------------------------------------
// PermissionPolicyStore — Drizzle-backed service for the `permission_policies`
// table. Used by:
//   - the runtime's permission bridge, to resolve `permission.requested`
//     against saved `scope: 'always'` decisions before the prompt goes out;
//   - `agent.permissions.*` oRPC routes, for the settings UI.
//
// Every method is sync under the hood (better-sqlite3); we wrap in
// `Effect.sync` for composition with the rest of the Effect-based runtime.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../infra/database'
import { deletePolicy, findPolicyById, listPoliciesByWorkspace, upsertPolicy } from './repository'
import type { PermissionPolicyInsert, PermissionPolicyRow } from './types'

interface PermissionPolicyStoreShape {
  readonly listByWorkspace: (workspaceId: string) => Effect.Effect<ReadonlyArray<PermissionPolicyRow>>
  readonly findById: (id: string) => Effect.Effect<PermissionPolicyRow | null>
  /**
   * Upsert-by-key: insert a policy, or overwrite the existing row for the
   * same (workspace, provider, toolKind, toolName, pattern) quad. Returns
   * the final row id.
   */
  readonly upsert: (input: PermissionPolicyInsert) => Effect.Effect<string>
  /** Delete a policy by id. Returns false if no row matched. */
  readonly delete: (id: string) => Effect.Effect<boolean>
}

export class PermissionPolicyStore extends Context.Tag('PermissionPolicyStore')<
  PermissionPolicyStore,
  PermissionPolicyStoreShape
>() {}

export const PermissionPolicyStoreLive = Layer.effect(
  PermissionPolicyStore,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      listByWorkspace: (workspaceId) => Effect.sync(() => listPoliciesByWorkspace(db, workspaceId)),

      findById: (id) => Effect.sync(() => findPolicyById(db, id)),

      upsert: (input) => Effect.sync(() => upsertPolicy(db, input)),

      delete: (id) => Effect.sync(() => deletePolicy(db, id)),
    }
  }),
)
