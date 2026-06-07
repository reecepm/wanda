import { type ClientLink, createORPCClient } from '@orpc/client'
import { createRouterUtils } from '@orpc/tanstack-query'
import type { AppClient } from '../../shared/contracts'

// Local-server RPC client. This is what `orpc.*` callers get by default —
// it goes over the renderer's WS transport to the EMBEDDED server the
// current Electron instance runs. Safe for anything that operates on local
// pods, workspaces, settings, etc.

const ipcLink: ClientLink<Record<never, never>> = {
  call: (path, input) => window.wanda.rpc.call(path, input),
}

export const orpc = createORPCClient<AppClient>(ipcLink)

export const orpcUtils = createRouterUtils(orpc)

export function onOrpcInvalidate(callback: (namespace: string) => void): () => void {
  return window.wanda.orpc.onInvalidate(callback)
}

// Paired-pod client routing.
//
// When the renderer is displaying a pod that actually lives on a paired
// REMOTE server, every mutation from the pod page's subtree — agent
// creation, window layout changes, pod-item CRUD, etc. — needs to hit
// the REMOTE server's RPC, not this local one. Without that, the local
// server happily 404s (or silently drops) and the remote never sees the
// change.
//
// The pod page owns the context. On mount, when it knows it's showing a
// remote pod, it calls `registerPodClient(namespacedPodId, pairedClient)`.
// On unmount it calls `unregisterPodClient(namespacedPodId)`.
//
// Callers that have a pod id in scope use `orpcForPod(namespacedPodId)`
// to get the RIGHT client at call time. Without a pod id (or for local
// pods) it returns the default local `orpc`. This is a lookup-only API:
// no React context needed, works from Zustand stores and any other
// non-React code.

const podClients = new Map<string, AppClient>()

export function registerPodClient(podId: string, client: AppClient): void {
  podClients.set(podId, client)
}

/**
 * Remove a pod's paired client from the routing map.
 *
 * Guards against a navigation race: when the user navigates from remote
 * pod A → remote pod B on the *same* paired server, React can execute
 * B's `registerPodClient` (synchronous useMemo during B's render) before
 * it runs A's cleanup effect. If the old cleanup then blindly calls
 * `podClients.delete(A)` it also wipes whatever was registered *for A's
 * id* in the meantime — which is fine — but a sibling/child effect
 * racing with a re-mount could overwrite B's entry. The `expectedClient`
 * compare-and-delete makes cleanup a no-op once the slot belongs to a
 * newer owner.
 */
export function unregisterPodClient(podId: string, expectedClient?: AppClient): void {
  if (expectedClient !== undefined) {
    const current = podClients.get(podId)
    if (current !== expectedClient) return
  }
  podClients.delete(podId)
}

/**
 * Resolve the RPC client that OWNS the given pod id. Returns the paired
 * client when the pod was namespaced as `remote:<registryId>:<uuid>`
 * AND the pod page has registered its paired client for it; otherwise
 * returns the local `orpc`. Safe to call with `undefined` / `null` /
 * any non-remote id — defaults to local.
 */
export function orpcForPod(podId: string | null | undefined): AppClient {
  if (!podId) return orpc
  const paired = podClients.get(podId)
  return paired ?? orpc
}

/** Extract the real server-side pod id from a possibly-namespaced one. */
export function unwrapPodId(podId: string): string {
  if (podId.startsWith('remote:')) {
    const rest = podId.slice('remote:'.length)
    const sep = rest.indexOf(':')
    if (sep > 0) return rest.slice(sep + 1)
  }
  return podId
}

/**
 * Split a namespaced id into its registry id + raw uuid, or return
 * `null` for local (non-namespaced) ids. Use this in sidebar /
 * workspace-explorer code where the mutation handler needs to decide
 * "do I call local orpc, or a paired client on a specific server?".
 */
export function parseNamespacedId(id: string): { registryId: string; rawId: string } | null {
  if (!id.startsWith('remote:')) return null
  const rest = id.slice('remote:'.length)
  const sep = rest.indexOf(':')
  if (sep <= 0) return null
  return { registryId: rest.slice(0, sep), rawId: rest.slice(sep + 1) }
}
