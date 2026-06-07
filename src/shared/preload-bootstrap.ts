import type { QueryClient } from '@tanstack/react-query'
import { GIT_SETTINGS_KEYS } from '@/features/workspace/hooks/use-workspace-explorer'
import { orpcUtils } from '@/shared/orpc'

/**
 * Layered data preloader for app bootstrap. Runs before the splash fades, so
 * all the sidebar + pod views have their queries warm in the TanStack Query
 * cache and render without a loading flicker.
 *
 * Pattern is intentionally explicit: "fetch this layer, read its results, use
 * them to fan out into the next layer". New data types slot into whichever
 * layer their dependencies exist in. If a new data type depends on pods, it
 * joins the per-pod layer; if it depends on workspaces, the per-workspace
 * layer; if it's standalone, the root layer.
 *
 * Pods are NOT started eagerly here. `usePodLifecycle` calls `ensureStarted`
 * when a pod's view mounts, so heavyweight agent processes (claude, codex)
 * only spawn for pods the user actually looks at. Eager-start on splash used
 * to stampede: N pods × ~2GB peak RSS each = instant memory pressure.
 */
export async function preloadBootstrap(queryClient: QueryClient): Promise<void> {
  // Layer 1: root-level data (no dependencies).
  await Promise.all([
    queryClient.prefetchQuery(orpcUtils.workspace.list.queryOptions({})),
    queryClient.prefetchQuery(orpcUtils.pod.detectEditors.queryOptions({})),
    queryClient.prefetchQuery(orpcUtils.settings.getMany.queryOptions({ input: { keys: [...GIT_SETTINGS_KEYS] } })),
    queryClient.prefetchQuery(orpcUtils.notification.listUnresolved.queryOptions({ input: {} })),
  ])

  const workspaces = queryClient.getQueryData(orpcUtils.workspace.list.queryKey({})) as
    | Array<{ id: string }>
    | undefined

  if (!workspaces || workspaces.length === 0) {
    return
  }

  // Layer 2: per-workspace data (depends on workspace list).
  await Promise.all(
    workspaces.flatMap((ws) => [
      queryClient.prefetchQuery(orpcUtils.pod.list.queryOptions({ input: { workspaceId: ws.id } })),
      queryClient.prefetchQuery(
        orpcUtils.workspaceSettings.getByWorkspace.queryOptions({
          input: { workspaceId: ws.id },
        }),
      ),
    ]),
  )

  const allPods = workspaces.flatMap((ws) => {
    const list = queryClient.getQueryData(orpcUtils.pod.list.queryKey({ input: { workspaceId: ws.id } })) as
      | Array<{ id: string }>
      | undefined
    return list ?? []
  })

  // Layer 3: per-pod data (no pod start — that happens lazily on view).
  await Promise.all(
    allPods.flatMap((pod) => [
      queryClient.prefetchQuery(orpcUtils.podItem.list.queryOptions({ input: { podId: pod.id } })),
      queryClient.prefetchQuery(orpcUtils.pod.listTerminals.queryOptions({ input: { podId: pod.id } })),
      queryClient.prefetchQuery(orpcUtils.pod.listCommands.queryOptions({ input: { podId: pod.id } })),
      queryClient.prefetchQuery(orpcUtils.view.listByPod.queryOptions({ input: { podId: pod.id } })),
    ]),
  )
}
