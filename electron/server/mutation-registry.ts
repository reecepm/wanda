// -----------------------------------------------------------------------------
// Type-safe mutation registry.
//
// The RPC client interceptor consulted on every procedure result. When a call
// matches `MUTATION_PATHS` it broadcasts `orpc:invalidate` so every client's
// TanStack Query refetches, and — for well-known resource CRUD — dual-publishes
// an `event:*` row through the EventLog so reconnecting clients can replay.
// -----------------------------------------------------------------------------

import type { EventChannel, ResourceKind } from '@wanda/wire'
import { MUTATION_PATHS } from './mutation-paths'

export interface MutationRegistryDeps {
  readonly broadcast: (channel: string, ...args: unknown[]) => void
  readonly publishEvent: (
    channel: EventChannel,
    resourceKind: ResourceKind,
    resourceId: string,
    payload: unknown,
  ) => void
}

type ClientInterceptor = (opts: {
  path: readonly string[]
  input: unknown
  next: () => Promise<unknown>
}) => Promise<unknown>

/**
 * Dual-publish well-known resource CRUD mutations as `event:*` through the
 * EventLog. Conservative: pod / workspace / podItem only, create/update/delete
 * only. Non-resource broadcasts (agent messages, git status, terminal bytes,
 * orpc:invalidate) stay on the legacy broadcast firehose.
 */
function maybePublishResourceEvent(
  deps: MutationRegistryDeps,
  path: readonly string[],
  method: string,
  input: unknown,
  result: unknown,
): void {
  const namespace = path[0]
  if (!namespace) return
  const action =
    method === 'create' ? 'created' : method === 'update' ? 'updated' : method === 'delete' ? 'deleted' : null
  if (!action) return

  let kind: ResourceKind | null = null
  if (namespace === 'pod') kind = 'pod'
  else if (namespace === 'workspace') kind = 'workspace'
  else if (namespace === 'podItem') kind = 'podItem'
  if (!kind) return

  const channel = `event:${kind}:${action}` as EventChannel
  const id =
    (result && typeof result === 'object' && 'id' in result && typeof (result as { id: unknown }).id === 'string'
      ? (result as { id: string }).id
      : null) ??
    (input && typeof input === 'object' && 'id' in input && typeof (input as { id: unknown }).id === 'string'
      ? (input as { id: string }).id
      : null)
  if (!id) return

  deps.publishEvent(channel, kind, id, { input, result })
}

/** Build the oRPC `clientInterceptors` array that drives the mutation registry. */
export function makeMutationInterceptors(deps: MutationRegistryDeps): ClientInterceptor[] {
  return [
    async ({ path, input, next }) => {
      const result = await next()
      const method = path.at(-1)
      const fullPath = path.join('.')
      if (method && fullPath in MUTATION_PATHS) {
        deps.broadcast('orpc:invalidate', path[0], method)
        maybePublishResourceEvent(deps, path, method, input, result)
      }
      return result
    },
  ]
}
