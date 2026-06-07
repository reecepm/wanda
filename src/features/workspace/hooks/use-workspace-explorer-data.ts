import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { watchGitRepo } from '@/features/git'
import { useNotificationUnresolvedInvalidation } from '@/features/notifications'
import { usePodStatusChange } from '@/features/pod'
import { probeAndHealServer, useServers } from '@/features/servers'
import { type PodItem, useViewStore } from '@/features/view'
import type {
  AgentStatus,
  AgentSummary,
  ChatSessionSummary,
  PodSummary,
  Workspace,
} from '@/features/workspace/components/workspace-list'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import type { AgentItemConfig, AgentSessionItemConfig } from '@/types/schema'
import { useAgentStatuses } from './use-agent-statuses'
import type { PendingPod } from './use-pending-pods'
import { sidebarPool } from './use-resolve-client'
import { GIT_SETTINGS_KEYS } from './worktree'

export type WorkspaceExplorerData = ReturnType<typeof useWorkspaceExplorerData>

/**
 * Fans out every query the sidebar needs — local workspaces / pods / pod items
 * / settings plus the paired-server remote fan-out — and folds them (together
 * with optimistic pending rows) into the combined `workspaces` tree the
 * sidebar renders.
 */
export function useWorkspaceExplorerData(pendingPods: Record<string, PendingPod>) {
  const queryClient = useQueryClient()
  const { expandedWorkspaces } = useUIStore()
  const { statusMap } = useAgentStatuses()

  const { data: workspacesRaw = [] } = useQuery(orpcUtils.workspace.list.queryOptions({}))

  // Unresolved attention notifications — joined to agents by podTerminalId so
  // the sidebar can show the yellow focus dot, a preview of the request, and
  // bubble the agent to the top. Push-invalidated on notification change.
  const { data: unresolvedNotifs = [] } = useQuery(orpcUtils.notification.listUnresolved.queryOptions({ input: {} }))
  useNotificationUnresolvedInvalidation()

  // UI-centric chat sessions, joined into the pod tree below. Workspace-
  // filter happens client-side — we fetch the whole list so the sidebar
  // shows chats under every pod without N per-workspace round-trips, and
  // the server-side row count is expected to stay in the low hundreds.
  const { data: persistedChatSessions = [] } = useQuery({
    ...orpcUtils.agent.session.listPersisted.queryOptions({ input: {} }),
    staleTime: 10_000,
  })

  // Map: podTerminalId → oldest unresolved blocking/urgent notification.
  // `listUnresolved` returns rows ordered oldest-first, so the first hit wins.
  const notificationByTerminal = useMemo(() => {
    const map = new Map<string, { title: string; body: string | null }>()
    for (const n of unresolvedNotifs) {
      if (!n.podTerminalId) continue
      if (n.priority !== 'blocking' && n.priority !== 'urgent') continue
      if (map.has(n.podTerminalId)) continue
      map.set(n.podTerminalId, { title: n.title, body: n.body })
    }
    return map
  }, [unresolvedNotifs])

  // sessionId → persisted row. Used below when deriving the per-pod chat-
  // session list: each pod-item with `contentType: 'agent-session'` joins
  // against this map for title + resident flag + lastEventAt.
  const chatSessionById = useMemo(() => {
    const map = new Map<string, (typeof persistedChatSessions)[number]>()
    for (const row of persistedChatSessions) map.set(row.sessionId, row)
    return map
  }, [persistedChatSessions])

  const { data: detectedEditors = [] } = useQuery({
    ...orpcUtils.pod.detectEditors.queryOptions({}),
    staleTime: 60_000,
  })

  const { data: gitSettings } = useQuery(
    orpcUtils.settings.getMany.queryOptions({ input: { keys: [...GIT_SETTINGS_KEYS] } }),
  )

  // Paired-server fan-out — workspaces + pods from every remote the user
  // paired with. Remote entries are tagged with `serverId` so downstream
  // code (context menus, handlers) can branch on local vs remote.
  const { data: pairedServers = [] } = useServers()

  // One workspace.list query per paired server. On stale-port errors
  // (remote restarted on a different port) we probe + heal once and
  // refresh the servers list; the next render will query at the new
  // baseUrl automatically.
  const remoteWorkspaceQueries = useQueries({
    queries: pairedServers.map((server) => ({
      queryKey: ['remote-ws-list', server.id, server.baseUrl] as const,
      queryFn: async () => {
        const conn = await sidebarPool.clientFor(server)
        try {
          return (await conn.client.workspace.list({})) as Array<{
            id: string
            name: string
            cwd?: string
            repoPath?: string | null
            iconUrl?: string | null
          }>
        } catch (err) {
          const msg = err instanceof Error ? err.message.toLowerCase() : ''
          const stale =
            msg.includes('failed to fetch') ||
            msg.includes('err_connection_refused') ||
            msg.includes('err_name_not_resolved') ||
            msg.includes('networkerror')
          if (stale) {
            const healed = await probeAndHealServer(server.id).catch(() => null)
            if (healed && healed !== server.baseUrl) {
              sidebarPool.remove(server.id)
              queryClient.invalidateQueries({ queryKey: ['servers:list'] })
              const conn2 = await sidebarPool.clientFor({ ...server, baseUrl: healed })
              return (await conn2.client.workspace.list({})) as Array<{
                id: string
                name: string
                cwd?: string
                repoPath?: string | null
              }>
            }
          }
          throw err
        }
      },
      staleTime: 15_000,
      retry: 1,
    })),
  })

  /** Stable flat list of (serverId, workspace) pairs for downstream queries. */
  const remoteWorkspaceRefs = useMemo(() => {
    const refs: Array<{
      serverId: string
      serverRegistryId: string
      serverLabel: string
      baseUrl: string
      workspace: { id: string; name: string; cwd?: string; iconUrl?: string | null }
    }> = []
    for (let i = 0; i < pairedServers.length; i++) {
      const server = pairedServers[i]
      if (!server) continue
      const wss = remoteWorkspaceQueries[i]?.data ?? []
      for (const ws of wss) {
        refs.push({
          serverId: server.serverId,
          serverRegistryId: server.id,
          serverLabel: server.label,
          baseUrl: server.baseUrl,
          workspace: ws,
        })
      }
    }
    return refs
  }, [pairedServers, remoteWorkspaceQueries])

  // One pod.list query per (paired server, workspace) pair. Flat keys so
  // useQueries is stable across renders even if a workspace appears and
  // disappears.
  const remotePodQueries = useQueries({
    queries: remoteWorkspaceRefs.map((ref) => ({
      queryKey: ['remote-pod-list', ref.serverRegistryId, ref.workspace.id] as const,
      queryFn: async () => {
        const conn = await sidebarPool.clientFor({
          id: ref.serverRegistryId,
          serverId: ref.serverId,
          label: ref.serverLabel,
          baseUrl: ref.baseUrl,
          addedAt: 0,
          lastConnectedAt: null,
        })
        return (await conn.client.pod.list({ workspaceId: ref.workspace.id })) as Array<{
          id: string
          name: string
          workspaceId: string
          status: string
          runtime?: unknown
          gitContext?: unknown
        }>
      },
      staleTime: 15_000,
      retry: 1,
    })),
  })

  const podQueries = useQueries({
    queries: workspacesRaw.map((p) => orpcUtils.pod.list.queryOptions({ input: { workspaceId: p.id } })),
  })

  // Flat list of pod ids, sorted for stable useQueries deps.
  const allPodIds = useMemo(
    () =>
      podQueries
        .flatMap((q) => q.data ?? [])
        .map((p) => p.id)
        .sort(),
    [podQueries],
  )

  // Preload pod items for every pod. Agents surface in the sidebar as soon as
  // pod data is available — we don't wait for the pod to be "running".
  const podItemQueries = useQueries({
    queries: allPodIds.map((id) => orpcUtils.podItem.list.queryOptions({ input: { podId: id } })),
  })

  const podItemsByPodId = useMemo(() => {
    const map = new Map<string, PodItem[]>()
    for (let i = 0; i < allPodIds.length; i++) {
      const podId = allPodIds[i]
      const data = podItemQueries[i]?.data as PodItem[] | undefined
      if (podId && data) map.set(podId, data)
    }
    return map
  }, [allPodIds, podItemQueries])

  // Identify local pods (no docker runtime). Git stats are only fetched +
  // displayed for local pods — remote pods would need round-trip shell
  // exec for every git call, and the status dot already occupies the
  // right-side slot we render the badge in.
  const { distinctLocalRepoPaths } = useMemo(() => {
    const repos = new Set<string>()
    for (const q of podQueries) {
      for (const pod of q.data ?? []) {
        const runtimeType =
          pod.runtime && typeof pod.runtime === 'object' && 'type' in pod.runtime
            ? (pod.runtime as { type?: string }).type
            : undefined
        const isLocal = runtimeType !== 'docker'
        if (!isLocal) continue
        const gc = pod.gitContext as { repoPath?: string } | null
        const repoPath = gc?.repoPath ?? pod.cwd
        if (repoPath) repos.add(repoPath)
      }
    }
    return { distinctLocalRepoPaths: Array.from(repos) }
  }, [podQueries])

  // Per-pod git state is owned by `useGitStatus(podId)` inside `PodGitBadge`
  // — no batch query here anymore. We still eagerly register each repo with
  // the main-process GitWatcher below so status updates flow the moment a
  // `.git` file mutates, even before a badge mounts.

  // Register each distinct repo with the main-process GitWatcher once.
  // `watchRepo` is idempotent on the main side, but we also track locally
  // to avoid repeated IPC sends on re-renders.
  const watchedReposRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const repoPath of distinctLocalRepoPaths) {
      if (!watchedReposRef.current.has(repoPath)) {
        watchedReposRef.current.add(repoPath)
        watchGitRepo(repoPath)
      }
    }
  }, [distinctLocalRepoPaths])

  const wsSettingsQueries = useQueries({
    queries: workspacesRaw.map((p) =>
      orpcUtils.workspaceSettings.getByWorkspace.queryOptions({ input: { workspaceId: p.id } }),
    ),
  })

  const workspaceSettingsMap = useMemo(() => {
    const map = new Map<string, NonNullable<(typeof wsSettingsQueries)[number]['data']>>()
    for (let i = 0; i < workspacesRaw.length; i++) {
      const workspace = workspacesRaw[i]
      const data = wsSettingsQueries[i]?.data
      if (workspace && data) map.set(workspace.id, data)
    }
    return map
  }, [workspacesRaw, wsSettingsQueries])

  usePodStatusChange(
    useCallback(() => {
      for (const workspace of workspacesRaw) {
        queryClient.invalidateQueries({ queryKey: orpcUtils.pod.list.key({ input: { workspaceId: workspace.id } }) })
      }
    }, [queryClient, workspacesRaw]),
  )

  // View store still tracks the currently-loaded pod's live item labels (e.g.
  // after a rename). When present, we prefer its items so in-session label
  // edits show up in the sidebar without waiting for a query refetch.
  const viewStorePods = useViewStore((s) => s.entities)

  // Build remote workspaces + pods from the paired-server fan-out. Remote
  // IDs are namespaced with `remote:<registryId>:<uuid>` so the renderer's
  // selection state (activePodId, expandedWorkspaces, route params) can't
  // collide with a local UUID that happens to match.
  const remoteWorkspaceEntries = useMemo(() => {
    return remoteWorkspaceRefs.map((ref, idx) => {
      const pods = (remotePodQueries[idx]?.data ?? []).map((pod) => {
        const runtimeType =
          pod.runtime && typeof pod.runtime === 'object' && 'type' in pod.runtime
            ? (pod.runtime as { type?: string }).type
            : undefined
        const runtimeKind: PodSummary['runtimeKind'] = runtimeType === 'docker' ? 'docker' : 'shell'
        const isLocal = runtimeType !== 'docker'
        const podNsId = `remote:${ref.serverRegistryId}:${pod.id}`
        const wsNsId = `remote:${ref.serverRegistryId}:${ref.workspace.id}`
        const summary: PodSummary = {
          id: podNsId,
          name: pod.name,
          status: pod.status as PodSummary['status'],
          runtimeKind,
          isLocal,
          workspaceId: wsNsId,
          hasWorktree: !!(
            pod.gitContext &&
            typeof pod.gitContext === 'object' &&
            'worktreePath' in pod.gitContext &&
            (pod.gitContext as { worktreePath?: string }).worktreePath
          ),
          serverId: ref.serverRegistryId,
        }
        const pending = pendingPods[podNsId]
        return pending
          ? {
              ...summary,
              status: pending.status,
              isPending: true,
              progressLabel: pending.label,
              hasWorktree: summary.hasWorktree || pending.hasWorktree,
            }
          : summary
      })
      const realIds = new Set(pods.map((pod) => pod.id))
      const optimisticPods: PodSummary[] = Object.values(pendingPods)
        .filter(
          (pod) =>
            pod.phase === 'creating' &&
            pod.workspaceId === `remote:${ref.serverRegistryId}:${ref.workspace.id}` &&
            !realIds.has(pod.id),
        )
        .map((pod) => ({
          id: pod.id,
          name: pod.name,
          status: pod.status,
          runtimeKind: 'shell',
          isPending: true,
          progressLabel: pod.label,
          isLocal: false,
          workspaceId: `remote:${ref.serverRegistryId}:${ref.workspace.id}`,
          hasWorktree: pod.hasWorktree,
          serverId: ref.serverRegistryId,
        }))
      return {
        id: `remote:${ref.serverRegistryId}:${ref.workspace.id}`,
        name: ref.workspace.name,
        pods: [...pods, ...optimisticPods],
        serverId: ref.serverRegistryId,
        serverLabel: ref.serverLabel,
        iconUrl: ref.workspace.iconUrl ?? null,
      } satisfies Workspace
    })
  }, [remoteWorkspaceRefs, remotePodQueries, pendingPods])

  const localWorkspaces: Workspace[] = useMemo(
    () =>
      workspacesRaw.map((p, i) => {
        const realPods = (podQueries[i]?.data ?? []).map((pod) => {
          const status = pod.status as PodSummary['status']
          const runtimeType =
            pod.runtime && typeof pod.runtime === 'object' && 'type' in pod.runtime
              ? (pod.runtime as { type?: string }).type
              : undefined
          const runtimeKind: PodSummary['runtimeKind'] = runtimeType === 'docker' ? 'docker' : 'shell'
          const isLocal = runtimeType !== 'docker'

          // Derive agents directly from pod items. The view store takes
          // precedence when it's loaded (live labels), otherwise we fall
          // back to the TanStack Query cache seeded by preloadBootstrap.
          const storeItems = viewStorePods[pod.id]?.podItems
          const items = (storeItems ?? podItemsByPodId.get(pod.id) ?? []) as PodItem[]
          const agentItems = items.filter((pi) => pi.contentType === 'agent')
          const agents: AgentSummary[] | undefined =
            agentItems.length > 0
              ? agentItems.map((pi) => {
                  const cfg = pi.config as AgentItemConfig
                  const statusInfo = statusMap.get(cfg.podTerminalId)
                  const agentStatus = (statusInfo?.status ?? 'idle') as AgentStatus
                  // Attention is sourced from unresolved notifications joined by
                  // podTerminalId — the sidebar shows the amber focus dot, the
                  // preview text, and bubbles agents with attention to the top.
                  // Error status still surfaces as attention as a fallback.
                  const notif = notificationByTerminal.get(cfg.podTerminalId)
                  const needsAttention = !!notif || agentStatus === 'error'
                  const attentionReason = notif ? (notif.body ?? notif.title) : undefined
                  return {
                    id: cfg.podAgentId,
                    name: pi.label,
                    agentType: cfg.agentType,
                    status: agentStatus,
                    podTerminalId: cfg.podTerminalId,
                    needsAttention,
                    attentionReason,
                  }
                })
              : undefined

          // Chat sessions: one row per `agent-session` pod item, joined to
          // the persisted session row for title + state + resident flag.
          // Items whose session is not yet in the list-persisted cache get
          // rendered with fallback placeholders so a fresh create doesn't
          // flicker out of the sidebar while the query settles.
          const chatSessionItems = items.filter((pi) => pi.contentType === 'agent-session')
          const chatSessions: ChatSessionSummary[] | undefined =
            chatSessionItems.length > 0
              ? chatSessionItems.flatMap((pi) => {
                  const cfg = pi.config as AgentSessionItemConfig
                  if (!cfg.sessionId) return []
                  const row = chatSessionById.get(cfg.sessionId)
                  const name = (row?.title && row.title.length > 0 ? row.title : pi.label) ?? 'Untitled'
                  return [
                    {
                      id: pi.id,
                      sessionId: cfg.sessionId,
                      name,
                      providerId: row?.providerId ?? cfg.providerId ?? 'unknown',
                      state: row?.state ?? 'cold',
                      resident: row?.resident ?? false,
                      lastEventAt: row?.lastEventAt ?? null,
                    } satisfies ChatSessionSummary,
                  ]
                })
              : undefined

          const summary: PodSummary = {
            id: pod.id,
            name: pod.name,
            status,
            runtimeKind,
            isLocal,
            workspaceId: p.id,
            agents,
            chatSessions,
            hasWorktree: !!(
              pod.gitContext &&
              typeof pod.gitContext === 'object' &&
              'worktreePath' in pod.gitContext &&
              pod.gitContext.worktreePath
            ),
            serverId: null,
          }
          const pending = pendingPods[pod.id]
          return pending
            ? {
                ...summary,
                status: pending.status,
                isPending: true,
                progressLabel: pending.label,
                hasWorktree: summary.hasWorktree || pending.hasWorktree,
              }
            : summary
        })
        const realIds = new Set(realPods.map((pod) => pod.id))
        const optimisticPods: PodSummary[] = Object.values(pendingPods)
          .filter((pod) => pod.phase === 'creating' && pod.workspaceId === p.id && !realIds.has(pod.id))
          .map((pod) => ({
            id: pod.id,
            name: pod.name,
            status: pod.status,
            runtimeKind: 'shell',
            isPending: true,
            progressLabel: pod.label,
            isLocal: false,
            workspaceId: p.id,
            hasWorktree: pod.hasWorktree,
            serverId: null,
          }))
        return {
          id: p.id,
          name: p.name,
          serverId: null,
          iconUrl: p.iconUrl ?? null,
          pods: [...realPods, ...optimisticPods],
        }
      }),
    [
      workspacesRaw,
      podQueries,
      viewStorePods,
      podItemsByPodId,
      statusMap,
      notificationByTerminal,
      chatSessionById,
      pendingPods,
    ],
  )

  const workspaces: Workspace[] = useMemo(
    () => [...localWorkspaces, ...remoteWorkspaceEntries],
    [localWorkspaces, remoteWorkspaceEntries],
  )

  // Until the persisted expanded set is restored, default all workspaces expanded.
  const effectiveExpanded = useMemo(() => {
    if (expandedWorkspaces !== null) return expandedWorkspaces
    return new Set([...workspacesRaw.map((p) => p.id), ...remoteWorkspaceEntries.map((w) => w.id)])
  }, [expandedWorkspaces, workspacesRaw, remoteWorkspaceEntries])

  return {
    workspaces,
    workspacesRaw,
    podQueries,
    detectedEditors,
    effectiveExpanded,
    gitSettings,
    workspaceSettingsMap,
  }
}
