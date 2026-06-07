import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { CommandConfig } from '@/features/view/components/tab-content'
import { getPodColor, type PodMeta } from '@/features/view/scope'
import type { PodItem } from '@/features/view/utils/view-strategies'
import { orpcUtils } from '@/shared/orpc'
import { useAppearanceStore } from '@/stores/appearance-store'
import type { ViewConfig, ViewItemSettings } from '@/types/schema'
import type { RunningTerminal, TerminalConfig } from '@/types/terminal'

/** TerminalConfig extended with podId for workspace-scope lookups. */
export type WorkspaceTerminalConfig = TerminalConfig & { podId: string }

/** RunningTerminal extended with podId for workspace-scope lookups. */
export type WorkspaceRunningTerminal = RunningTerminal & { podId: string }

/** CommandConfig extended with podId for workspace-scope lookups. */
export type WorkspaceCommandConfig = CommandConfig & { podId: string }

/** RunningCommand extended with podId for workspace-scope lookups. */
export type WorkspaceRunningCommand = { podCommandId: string; ptyInstanceId: string; name: string; podId: string }

export interface WorkspaceViewData {
  workspace: { id: string; name: string; activeWorkspaceViewId?: string | null } | undefined
  pods: PodMeta[]
  podItems: PodItem[]
  views: {
    id: string
    name: string
    viewType: string
    config?: ViewConfig | null
    itemSettings: Record<string, ViewItemSettings>
  }[]
  terminalConfigs: WorkspaceTerminalConfig[]
  runningTerminals: WorkspaceRunningTerminal[]
  commandConfigs: WorkspaceCommandConfig[]
  runningCommands: WorkspaceRunningCommand[]
  detectedEditors: { id: string; name: string }[]
  activeViewId: string | null
  /** True while views + items queries are loading (blocks initial render) */
  isLoading: boolean
  /** True while terminal/command configs are loading (non-blocking) */
  isConfigsLoading: boolean
}

export function useWorkspaceViewData(workspaceId: string): WorkspaceViewData {
  const { data: workspace } = useQuery(orpcUtils.workspace.getById.queryOptions({ input: { id: workspaceId } }))

  const { data: rawViews, isLoading: viewsLoading } = useQuery(
    orpcUtils.workspaceView.list.queryOptions({ input: { workspaceId } }),
  )

  const { data: rawItems, isLoading: itemsLoading } = useQuery({
    ...orpcUtils.workspaceView.aggregatedItems.queryOptions({ input: { workspaceId } }),
    staleTime: 2_000,
  })

  const { data: configs, isLoading: configsLoading } = useQuery({
    ...orpcUtils.workspaceView.aggregatedConfigs.queryOptions({ input: { workspaceId } }),
    staleTime: 2_000,
  })

  const hasRunningPods = rawItems?.some((i) => i.podStatus === 'running') ?? false
  const { data: runningState } = useQuery({
    ...orpcUtils.workspaceView.aggregatedRunningState.queryOptions({ input: { workspaceId } }),
    refetchInterval: hasRunningPods ? 2000 : false,
  })

  const { data: detectedEditors = [] } = useQuery({
    ...orpcUtils.pod.detectEditors.queryOptions({}),
    staleTime: 60_000,
  })

  const accentColor = useAppearanceStore((s) => s.accentColor)
  const pods: PodMeta[] = useMemo(() => {
    if (!rawItems) return []
    const seen = new Map<string, PodMeta>()
    for (const item of rawItems) {
      if (!seen.has(item.podId)) {
        const idx = seen.size
        const color = getPodColor(idx, accentColor)
        seen.set(item.podId, {
          id: item.podId,
          name: item.podName,
          status: item.podStatus,
          color: color.hex,
        })
      }
    }
    return [...seen.values()]
  }, [rawItems, accentColor])

  const podItems: PodItem[] = useMemo(() => {
    if (!rawItems) return []
    return rawItems.map((item) => ({
      id: item.id,
      podId: item.podId,
      contentType: item.contentType as PodItem['contentType'],
      label: item.label,
      labelSource: item.labelSource,
      config: item.config,
      sortOrder: item.sortOrder,
    }))
  }, [rawItems])

  const views = useMemo(() => {
    if (!rawViews) return []
    return rawViews.map((v) => ({
      id: v.id,
      name: v.name,
      viewType: v.viewType,
      config: v.config,
      itemSettings: (v.itemSettings ?? {}) as Record<string, ViewItemSettings>,
    }))
  }, [rawViews])

  const terminalConfigs: WorkspaceTerminalConfig[] = useMemo(() => {
    if (!configs?.terminalConfigs) return []
    return configs.terminalConfigs.map((t) => ({
      id: t.id,
      podId: t.podId,
      name: t.name,
      command: t.command,
      args: t.args,
      env: t.env,
      restartPolicy: t.restartPolicy,
    }))
  }, [configs])

  const commandConfigs: WorkspaceCommandConfig[] = useMemo(() => {
    if (!configs?.commandConfigs) return []
    return configs.commandConfigs.map((c) => ({
      id: c.id,
      podId: c.podId,
      name: c.name,
      command: c.command,
      directory: c.directory,
      directoryMode: c.directoryMode,
      autoStart: c.autoStart,
      sortOrder: c.sortOrder,
      tags: [],
    }))
  }, [configs])

  return {
    workspace,
    pods,
    podItems,
    views,
    terminalConfigs,
    runningTerminals: (runningState?.runningTerminals ?? []) as WorkspaceRunningTerminal[],
    commandConfigs,
    runningCommands: (runningState?.runningCommands ?? []) as WorkspaceRunningCommand[],
    detectedEditors,
    activeViewId: workspace?.activeWorkspaceViewId ?? null,
    isLoading: viewsLoading || itemsLoading,
    isConfigsLoading: configsLoading,
  }
}
