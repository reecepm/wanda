// Wrap a paired-server oRPC client so every mutation routes through the
// main-process outbox. Queries pass through to the raw client unchanged
// — TanStack Query already handles refetch on reconnect, and queueing
// reads would waste work on replay.
//
// Classification is by method-name prefix. "Mutations" = everything that
// isn't an obvious read. The heuristic errs on the side of enqueueing:
// a misclassified query that routes through the outbox still works
// (enqueue → fire → succeed → auto-remove), it just touches the DB
// once. The reverse — a misclassified mutation that bypasses the outbox
// — would silently lose the user's work on a disconnect.

import type { AppClient } from '../../shared/contracts'

const QUERY_PREFIXES = [
  'list',
  'get',
  'find',
  'has',
  'count',
  'detect',
  'search',
  'is',
  'read',
  'resolve',
  'load',
  'peek',
  'ping',
  'view',
  'inspect',
  'capabilities',
  'status',
  'running',
  'listOnline',
]

function isQueryMethod(methodName: string): boolean {
  for (const prefix of QUERY_PREFIXES) {
    if (methodName === prefix) return true
    if (methodName.startsWith(prefix)) {
      // `get` matches `getById`, `list` matches `listByPod`, etc. Reject
      // `setCwd` matching `set` by requiring the next char to be upper
      // case so we only match prefix + PascalCase tail.
      const tail = methodName.slice(prefix.length)
      if (tail.length === 0) return true
      const next = tail[0]
      if (next && next === next.toUpperCase() && next !== next.toLowerCase()) return true
    }
  }
  return false
}

/**
 * Return an AppClient shaped identically to `client` but whose mutation
 * leaves route through `window.wanda.outbox.enqueueAndFire`. Paths are
 * dotted (`workspace.create`, `pod.addTerminal`). Nested namespaces are
 * handled recursively — no depth limit.
 */
export function wrapPairedClientWithOutbox(client: AppClient, registryId: string): AppClient {
  return wrapNamespace(client, registryId, '') as AppClient
}

export async function drainPairedOutbox(registryId: string): Promise<void> {
  await window.wanda.outbox.drain(registryId)
}

function wrapNamespace(target: unknown, registryId: string, path: string): unknown {
  // Callable + property-accessible proxy — mirrors oRPC's own client shape.
  // The `target` is forwarded verbatim for query calls; mutations short-
  // circuit to the outbox.
  //
  // WARNING: oRPC's client is a Proxy whose `get` trap treats EVERY string
  // property — including `apply`, `bind`, `call` — as another path
  // segment. So `target.apply(target, args)` on an oRPC client builds a
  // request for `.../apply` and returns 404. Forward calls with a direct
  // invocation syntax (`target(...args)`) instead.
  const fn = function (this: unknown, ...args: unknown[]) {
    const methodName = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path
    if (path && !isQueryMethod(methodName)) {
      return enqueueViaOutbox(registryId, path, args[0])
    }
    return (target as (...a: unknown[]) => unknown)(...args)
  }

  return new Proxy(fn, {
    get(_fnTarget, prop, _receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target as object, prop)
      }
      const real = (target as Record<string, unknown>)[prop]
      if (real === undefined) return undefined
      const nextPath = path ? `${path}.${prop}` : prop
      return wrapNamespace(real, registryId, nextPath)
    },
    has(_fnTarget, prop) {
      return Reflect.has(target as object, prop)
    },
    ownKeys() {
      return Reflect.ownKeys(target as object)
    },
    getOwnPropertyDescriptor(_fnTarget, prop) {
      return Object.getOwnPropertyDescriptor(target as object, prop)
    },
  })
}

async function enqueueViaOutbox(registryId: string, method: string, input: unknown): Promise<unknown> {
  const result = await window.wanda.outbox.enqueueAndFire(registryId, method, input)
  if (result.ok) return result.result
  // Rejected attempts throw so callers surface the error like a normal
  // failed RPC. The entry stays in the outbox for `onReconnect` retry
  // on transient failures (network); non-transient errors already
  // removed it server-side of the service and won't replay.
  throw new Error(result.error ?? `outbox: mutation "${method}" failed`)
}
