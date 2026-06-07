import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useGitStatusMulti } from '@/features/git'
import { useNotificationChanged } from '@/features/notifications'
import { usePodStatusChange } from '@/features/pod/hooks/use-pod-lifecycle'
import { type AgentStatusInfo, useAgentPermissionRequests, useAgentStatuses } from '@/features/workspace'
import { orpcUtils } from '@/shared/orpc'

export interface TrayPodAgent {
  id: string
  name: string
  agentType: string
  podTerminalId: string
  status: AgentStatusInfo | undefined
  needsAttention: boolean
}

export interface TrayGitSummary {
  branch: string | null
  filesChanged: number
  filesUntracked: number
  additions: number
  deletions: number
}

export interface TrayPod {
  id: string
  name: string
  status: string
  workspaceId: string
  workspaceName: string
  cwd: string
  agents: TrayPodAgent[]
  gitSummary: TrayGitSummary | null
  updatedAt: Date | null
}

export interface TrayWorkspace {
  id: string
  name: string
  pods: TrayPod[]
}

export function useTrayData() {
  const queryClient = useQueryClient()

  const { data: workspaces = [] } = useQuery(orpcUtils.workspace.list.queryOptions({}))

  const podQueries = useQueries({
    queries: workspaces.map((w) => orpcUtils.pod.list.queryOptions({ input: { workspaceId: w.id } })),
  })

  const allPods = useMemo(
    () =>
      podQueries.flatMap(
        (q) =>
          (q.data ?? []) as Array<{
            id: string
            name: string
            status: string
            workspaceId: string
            cwd: string
            updatedAt: Date | null
          }>,
      ),
    [podQueries],
  )

  const agentQueries = useQueries({
    queries: allPods.map((pod) => orpcUtils.pod.listAgents.queryOptions({ input: { podId: pod.id } })),
  })

  // Git status per running pod — single subscription-backed hook. Updates
  // push from the server over WS; no polling.
  const runningPods = allPods.filter((p) => p.status === 'running')
  const runningPodIds = useMemo(() => runningPods.map((p) => p.id), [runningPods])
  const gitStatusMap = useGitStatusMulti(runningPodIds)

  const gitMap = useMemo(() => {
    const m = new Map<string, TrayGitSummary>()
    for (const pod of runningPods) {
      const st = gitStatusMap.get(pod.id)
      if (!st || !st.local.isRepo) continue
      const { dirty, diffStats, branch } = st.local
      m.set(pod.id, {
        branch,
        filesChanged: dirty.staged + dirty.unstaged,
        filesUntracked: dirty.untracked,
        additions: diffStats.additions,
        deletions: diffStats.deletions,
      })
    }
    return m
  }, [runningPods, gitStatusMap])

  const agentMap = useMemo(() => {
    const m = new Map<
      string,
      Array<{ id: string; name: string; agentType: string; podTerminalId: string; needsAttention: boolean }>
    >()
    allPods.forEach((pod, i) => {
      const agents = agentQueries[i]?.data as
        | Array<{
            id: string
            name: string
            agentType: string
            podTerminalId: string
            needsAttention: boolean
          }>
        | undefined
      if (agents) m.set(pod.id, agents)
    })
    return m
  }, [allPods, agentQueries])

  const { data: notificationCounts } = useQuery({
    ...orpcUtils.notification.unresolvedCounts.queryOptions({ input: {} }),
    refetchInterval: 30_000,
  })

  const { data: unresolvedNotifications = [] } = useQuery({
    ...orpcUtils.notification.listUnresolved.queryOptions({ input: {} }),
    refetchInterval: 30_000,
  })

  const { statusMap, getStatus } = useAgentStatuses()

  usePodStatusChange(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['pod'] })
    }, [queryClient]),
  )

  useNotificationChanged(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['notification'] })
    }, [queryClient]),
  )

  useAgentPermissionRequests(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['notification'] })
    }, [queryClient]),
  )

  const trayWorkspaces: TrayWorkspace[] = workspaces.map((ws, i) => {
    const pods = (podQueries[i]?.data ?? []) as Array<{
      id: string
      name: string
      status: string
      workspaceId: string
      cwd: string
      updatedAt: Date | null
    }>

    return {
      id: ws.id,
      name: ws.name,
      pods: pods.map((pod) => ({
        id: pod.id,
        name: pod.name,
        status: pod.status,
        workspaceId: pod.workspaceId,
        workspaceName: ws.name,
        cwd: pod.cwd,
        updatedAt: pod.updatedAt,
        gitSummary: gitMap.get(pod.id) ?? null,
        agents: (agentMap.get(pod.id) ?? []).map((agent) => ({
          id: agent.id,
          name: agent.name,
          agentType: agent.agentType,
          podTerminalId: agent.podTerminalId,
          status: getStatus(agent.podTerminalId),
          needsAttention: agent.needsAttention,
        })),
      })),
    }
  })

  const runningPodCount = trayWorkspaces.reduce(
    (sum, ws) => sum + ws.pods.filter((p) => p.status === 'running').length,
    0,
  )

  return {
    workspaces: trayWorkspaces,
    unresolvedNotifications,
    notificationCounts: notificationCounts ?? null,
    runningPodCount,
    agentStatusMap: statusMap,
  }
}
