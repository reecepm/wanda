// Thin TanStack Query adapters over `window.wanda.servers.*` — all real
// logic lives in the main-process ServerRegistry.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { forgetAllForServer } from '@/features/terminal'
import type { PairedSessionSummary, WsTokenResult } from '../../../shared/contracts/auth'
import type { ServerCapabilities } from '../../../shared/contracts/capabilities'
import type { LocalPairingUrl, LocalServerInfo, PairedServerView } from '../../../shared/contracts/servers'
import { sharedPool } from './fan-out'
import { serversQueryKeys } from './query-keys'

function servers() {
  return window.wanda.servers
}

function localServer() {
  return window.wanda.localServer
}

export function getServerSessionToken(id: string): Promise<string | null> {
  return servers().getSessionToken(id)
}

export function getServerCapabilities(id: string): Promise<ServerCapabilities> {
  return servers().capabilities(id)
}

export function listPairedServers(): Promise<PairedServerView[]> {
  return servers().list()
}

export function probeAndHealServer(id: string): Promise<string | null> {
  return servers().probeAndHeal(id)
}

export function issueServerWsToken(id: string): Promise<WsTokenResult> {
  return servers().issueWsToken(id)
}

export function getLocalServerInfo(): Promise<LocalServerInfo | null> {
  return localServer().info()
}

export function listIncomingSessions(): Promise<PairedSessionSummary[]> {
  return localServer().incomingSessions()
}

export function revokeIncomingSession(sessionId: string): Promise<boolean> {
  return localServer().revokeIncomingSession(sessionId)
}

export function issueLocalPairingUrl(): Promise<LocalPairingUrl | null> {
  return localServer().issuePairingUrl()
}

export interface ServerProbeResult {
  step: string
  ok: boolean
  detail: string
}

export async function probePairedServerConnection(
  server: PairedServerView,
  onStep?: (result: ServerProbeResult) => void,
): Promise<ServerProbeResult[]> {
  const results: ServerProbeResult[] = []
  const push = (result: ServerProbeResult) => {
    results.push(result)
    onStep?.(result)
  }

  const token = await getServerSessionToken(server.id)
  if (!token) {
    push({ step: 'getSessionToken', ok: false, detail: 'registry returned null, not paired or token lost' })
    return results
  }
  push({ step: 'getSessionToken', ok: true, detail: `${token.length} chars, starts "${token.slice(0, 8)}..."` })

  try {
    const capsRes = await fetch(`${server.baseUrl}/api/capabilities`, {
      headers: { authorization: `Bearer ${token}` },
    })
    const body = await capsRes.text().catch(() => '')
    push({
      step: 'GET /api/capabilities',
      ok: capsRes.ok,
      detail: `${capsRes.status} ${capsRes.statusText}, ${body.slice(0, 160)}`,
    })
  } catch (err) {
    push({
      step: 'GET /api/capabilities',
      ok: false,
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    })
  }

  try {
    const wsRes = await fetch(`${server.baseUrl}/workspace/list`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ json: {} }),
    })
    const body = await wsRes.text().catch(() => '')
    push({
      step: 'POST /workspace/list',
      ok: wsRes.ok,
      detail: `${wsRes.status} ${wsRes.statusText}, ${body.slice(0, 200)}`,
    })
  } catch (err) {
    push({
      step: 'POST /workspace/list',
      ok: false,
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    })
  }

  return results
}

export function useServers() {
  return useQuery({
    queryKey: serversQueryKeys.list(),
    queryFn: () => servers().list(),
    staleTime: 5_000,
  })
}

export function useServerCapabilities(id: string | null | undefined) {
  return useQuery<ServerCapabilities>({
    queryKey: id ? serversQueryKeys.capabilities(id) : serversQueryKeys.capabilities('__nil__'),
    queryFn: () => servers().capabilities(id!),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function usePairServer() {
  const qc = useQueryClient()
  return useMutation<PairedServerView, Error, string>({
    mutationFn: (pairingUrl) => servers().pair(pairingUrl),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: serversQueryKeys.all })
    },
  })
}

export function useRemoveServer() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => servers().remove(id),
    onSuccess: (_data, id) => {
      forgetAllForServer(id)
      sharedPool.remove(id)
      qc.invalidateQueries({ queryKey: serversQueryKeys.all })
    },
  })
}

export function useIssueWsToken() {
  return useMutation<WsTokenResult, Error, string>({
    mutationFn: (id) => servers().issueWsToken(id),
  })
}
