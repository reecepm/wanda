// Inventory queries for the Machines page.
//
// `pod.list` is scoped to a workspace, so collecting a full inventory means
// listing workspaces first and then fanning out to each. The paired variant
// additionally auto-heals stale `baseUrl`s by probing for the server's new
// port when a fetch smells like "server moved" (ERR_CONNECTION_REFUSED).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'
import type { PairedSessionSummary } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import type { LocalServerInfo, PairedServerView } from '../../../shared/contracts/servers'
import { createServerPool } from './server-pool'
import {
  getLocalServerInfo,
  getServerCapabilities,
  getServerSessionToken,
  listIncomingSessions,
  probeAndHealServer,
} from './use-servers'

// Per-page connection pool.
const machinesPool = createServerPool({
  getSessionToken: getServerSessionToken,
})

export interface WorkspaceLite {
  id: string
  name: string
  cwd?: string
}

export interface PodLite {
  id: string
  name: string
  workspaceId?: string | null
  status: string
}

export interface MachineInventory {
  workspaces: WorkspaceLite[]
  pods: PodLite[]
}

export const podStatusColor: Record<string, string> = {
  running: 'bg-emerald-500',
  starting: 'bg-amber-400 animate-pulse',
  stopping: 'bg-amber-400 animate-pulse',
  stopped: 'bg-zinc-600',
  failed: 'bg-red-500',
}

async function collectInventory(
  listWorkspaces: () => Promise<WorkspaceLite[]>,
  listPodsInWorkspace: (workspaceId: string) => Promise<PodLite[]>,
): Promise<MachineInventory> {
  const workspaces = await listWorkspaces()
  const perWorkspace = await Promise.all(
    workspaces.map((ws) =>
      listPodsInWorkspace(ws.id)
        .then((pods) => pods.map((p) => ({ ...p, workspaceId: ws.id })))
        .catch(() => [] as PodLite[]),
    ),
  )
  return { workspaces, pods: perWorkspace.flat() }
}

function toPodLite(p: { id: string; name: string; workspaceId?: string | null; status: string }): PodLite {
  return { id: p.id, name: p.name, workspaceId: p.workspaceId ?? null, status: p.status }
}

function toWorkspaceLite(w: { id: string; name: string; cwd?: string | null }): WorkspaceLite {
  return { id: w.id, name: w.name, cwd: w.cwd ?? undefined }
}

export function useLocalInventory(enabled: boolean) {
  return useQuery({
    queryKey: ['machines', 'local-inventory'],
    queryFn: () =>
      collectInventory(
        async () => (await orpcUtils.workspace.list.call({})).map(toWorkspaceLite),
        async (workspaceId) => (await orpcUtils.pod.list.call({ workspaceId })).map(toPodLite),
      ),
    staleTime: 15_000,
    enabled,
  })
}

function isLikelyStalePortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('err_connection_refused') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('networkerror') ||
    msg.includes('econnrefused')
  )
}

export function usePairedInventory(server: PairedServerView, enabled: boolean) {
  const qc = useQueryClient()
  return useQuery({
    queryKey: ['machines', 'paired-inventory', server.id, server.baseUrl],
    queryFn: async () => {
      const attempt = async () => {
        const conn = await machinesPool.clientFor(server)
        return collectInventory(
          async () => (await conn.client.workspace.list({})).map(toWorkspaceLite),
          async (workspaceId) => (await conn.client.pod.list({ workspaceId })).map(toPodLite),
        )
      }
      try {
        return await attempt()
      } catch (err) {
        // Auto-heal: if the error smells like "server moved to a
        // different port" (ERR_CONNECTION_REFUSED / Failed to fetch),
        // ask the main process to probe `<hostname>:<default port>` and
        // update the stored baseUrl if the same serverId responds.
        // Then retry inventory ONCE against the healed URL.
        if (isLikelyStalePortError(err)) {
          console.warn('[machines] inventory fetch failed; probing for new baseUrl', {
            baseUrl: server.baseUrl,
            error: err instanceof Error ? err.message : String(err),
          })
          const newUrl = await probeAndHealServer(server.id).catch((probeErr) => {
            console.warn('[machines] probeAndHeal failed', {
              id: server.id,
              error: probeErr instanceof Error ? probeErr.message : String(probeErr),
            })
            return null
          })
          if (newUrl && newUrl !== server.baseUrl) {
            // Refresh the pool + paired-servers list so downstream
            // queries use the new URL.
            machinesPool.remove(server.id)
            qc.invalidateQueries({ queryKey: ['servers:list'] })
            // Retry with the new URL — the query's own queryKey will
            // change on the next render, so the retry here is a
            // best-effort immediate result to avoid a visible flash.
            try {
              const conn = await machinesPool.clientFor({ ...server, baseUrl: newUrl })
              const result = await collectInventory(
                async () => (await conn.client.workspace.list({})).map(toWorkspaceLite),
                async (workspaceId) => (await conn.client.pod.list({ workspaceId })).map(toPodLite),
              )
              return result
            } catch (retryErr) {
              console.error('[machines] retry after heal still failed', {
                baseUrl: newUrl,
                error: retryErr instanceof Error ? retryErr.message : String(retryErr),
              })
              throw retryErr
            }
          }
        }
        console.error('[machines] paired inventory FAILED', {
          baseUrl: server.baseUrl,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        })
        throw err
      }
    },
    staleTime: 15_000,
    retry: 1,
    enabled,
  })
}

export function usePairedCapabilities(server: PairedServerView) {
  return useQuery<ServerCapabilities>({
    queryKey: ['machines', 'paired-caps', server.id],
    queryFn: () => getServerCapabilities(server.id),
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

export function useLocalServerInfo() {
  return useQuery<LocalServerInfo | null>({
    queryKey: ['machines', 'local-server-info'],
    queryFn: getLocalServerInfo,
    staleTime: Infinity,
  })
}

export function useIncomingSessions() {
  return useQuery<PairedSessionSummary[]>({
    queryKey: ['machines', 'incoming-sessions'],
    queryFn: listIncomingSessions,
    refetchInterval: 10_000,
    staleTime: 5_000,
  })
}
