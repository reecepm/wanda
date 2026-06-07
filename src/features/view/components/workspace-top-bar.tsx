import { useCallback } from 'react'
import { POD_STATUS_COLORS } from '@/features/pod'
import { GraphiteStatusBadge } from '@/features/view/components/graphite-status-badge'
import { ViewTabStrip } from '@/features/view/components/view-tab-strip'
import type { PodMeta } from '@/features/view/scope'
import { ContentTopBar } from '@/layout/content-top-bar'
import { RiCodeSSlashLine, RiPlayFill, RiRestartLine, RiStopFill } from '@/lib/icons'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu'

interface WorkspaceTopBarProps {
  workspaceId: string
  pods: PodMeta[]
  detectedEditors: { id: string; name: string }[]
}

export function WorkspaceTopBar({ workspaceId, pods, detectedEditors }: WorkspaceTopBarProps) {
  const handlePodStart = useCallback(async (podId: string) => {
    await orpcForPod(podId).pod.start({ id: unwrapPodId(podId) })
  }, [])

  const handlePodStop = useCallback(async (podId: string) => {
    await orpcForPod(podId).pod.stop({ id: unwrapPodId(podId) })
  }, [])

  const handlePodRestart = useCallback(async (podId: string) => {
    await orpcForPod(podId).pod.restart({ id: unwrapPodId(podId) })
  }, [])

  const handleOpenInEditor = useCallback(async (podId: string, editor: string) => {
    await orpcForPod(podId).pod.openInEditor({
      podId: unwrapPodId(podId),
      editor: editor as 'zed' | 'vscode' | 'cursor',
    })
  }, [])

  return (
    <ContentTopBar>
      <ContentTopBar.Left>
        <div className="flex items-center gap-1">
          {pods.map((pod) => (
            <span
              key={pod.id}
              className={`h-2 w-2 rounded-full shrink-0 ${POD_STATUS_COLORS[pod.status as keyof typeof POD_STATUS_COLORS] ?? 'bg-zinc-600'}`}
              title={`${pod.name}: ${pod.status}`}
            />
          ))}
        </div>
        <ViewTabStrip podId={workspaceId} />
      </ContentTopBar.Left>
      <ContentTopBar.Right>
        <GraphiteStatusBadge workspaceId={workspaceId} />

        {/* Pod lifecycle controls */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Pod controls"
          >
            <RiPlayFill className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom">
            {pods.map((pod, i) => (
              <div key={pod.id}>
                <div className="px-2 py-1 text-[10px] font-medium text-zinc-500">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full mr-1.5"
                    style={{ backgroundColor: pod.color }}
                  />
                  {pod.name}
                </div>
                <div className="flex gap-0.5 px-2 pb-1">
                  {(pod.status === 'stopped' || pod.status === 'failed') && (
                    <button
                      type="button"
                      onClick={() => handlePodStart(pod.id)}
                      className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 transition-colors"
                      title="Start"
                    >
                      <RiPlayFill className="h-3 w-3" />
                    </button>
                  )}
                  {pod.status === 'running' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handlePodRestart(pod.id)}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-amber-400 transition-colors"
                        title="Restart"
                      >
                        <RiRestartLine className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePodStop(pod.id)}
                        className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
                        title="Stop"
                      >
                        <RiStopFill className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
                {i < pods.length - 1 && <DropdownMenuSeparator />}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Open in editor (per-pod dropdown) */}
        {detectedEditors.length > 0 && pods.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Open in editor"
            >
              <RiCodeSSlashLine className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              {pods.map((pod) => (
                <div key={pod.id}>
                  <div className="px-2 py-1 text-[10px] font-medium text-zinc-500">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full mr-1.5"
                      style={{ backgroundColor: pod.color }}
                    />
                    {pod.name}
                  </div>
                  {detectedEditors.map((editor) => (
                    <DropdownMenuItem
                      key={`${pod.id}-${editor.id}`}
                      onClick={() => handleOpenInEditor(pod.id, editor.id)}
                    >
                      {editor.name}
                    </DropdownMenuItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </ContentTopBar.Right>
    </ContentTopBar>
  )
}
