import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { use, useMemo, useState } from 'react'
import { highestPriority } from '@/features/notifications'
import { PodContextMenu } from '@/features/pod'
import { HoverPreviewBar } from '@/ui/hover-preview-bar'
import { PodHoverCard } from '../pod-row'
import { WorkspaceListContext } from './context'
import { SortablePod } from './sortable-pod'
import type { Workspace } from './types'

const verticalModifiers = [
  ({ transform }: { transform: { x: number; y: number; scaleX: number; scaleY: number } }) => ({
    ...transform,
    x: 0,
  }),
]

export function SortablePodList({
  workspace,
  selectedPodId,
  onSelectPod,
  onReorderPods,
  renamingPodId,
  onStartRename,
  onRenameSubmit,
  onRenameCancel,
}: {
  workspace: Workspace
  selectedPodId?: string
  onSelectPod: (podId: string) => void
  onReorderPods?: (workspaceId: string, podIds: string[]) => void
  renamingPodId: string | null
  onStartRename: (podId: string) => void
  onRenameSubmit: (podId: string, name: string) => void
  onRenameCancel: () => void
}) {
  const { notificationCounts, podMenuCallbacks } = use(WorkspaceListContext)!
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [orderedPodIds, setOrderedPodIds] = useState<string[] | null>(null)
  const localPods = useMemo(() => {
    if (!orderedPodIds) return workspace.pods
    const podsById = new Map(workspace.pods.map((pod) => [pod.id, pod]))
    const orderedPods = orderedPodIds.flatMap((id) => {
      const pod = podsById.get(id)
      return pod ? [pod] : []
    })
    const orderedIds = new Set(orderedPodIds)
    return [...orderedPods, ...workspace.pods.filter((pod) => !orderedIds.has(pod.id))]
  }, [workspace.pods, orderedPodIds])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = localPods.findIndex((p) => p.id === String(active.id))
    const newIndex = localPods.findIndex((p) => p.id === String(over.id))
    if (oldIndex !== -1 && newIndex !== -1) {
      const reordered = arrayMove(localPods, oldIndex, newIndex)
      setOrderedPodIds(reordered.map((p) => p.id))
      onReorderPods?.(
        workspace.id,
        reordered.map((p) => p.id),
      )
    }
  }

  const podIds = localPods.map((p) => p.id)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={verticalModifiers}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={podIds} strategy={verticalListSortingStrategy}>
        <HoverPreviewBar
          items={localPods}
          previewClassName="w-64 rounded-lg border border-zinc-800 bg-zinc-900/95 shadow-2xl shadow-black/50 backdrop-blur overflow-hidden"
          renderPreview={(pod) => <PodHoverCard pod={pod} />}
          renderTrigger={(pod, { onClick }) => {
            const sortable = (
              <SortablePod
                pod={pod}
                isSelected={selectedPodId === pod.id}
                onSelect={() => {
                  onClick()
                  onSelectPod(pod.id)
                }}
                isRenaming={renamingPodId === pod.id}
                onRenameSubmit={(name) => onRenameSubmit(pod.id, name)}
                onRenameCancel={onRenameCancel}
                badgePriority={highestPriority(notificationCounts?.byPod[pod.id])}
              />
            )
            return pod.isPending ? (
              sortable
            ) : (
              <PodContextMenu
                pod={pod}
                onStart={() => podMenuCallbacks.onPodStart?.(pod.id)}
                onStop={() => podMenuCallbacks.onPodStop?.(pod.id)}
                onRestart={() => podMenuCallbacks.onPodRestart?.(pod.id)}
                onRename={() => onStartRename(pod.id)}
                onDuplicate={() => podMenuCallbacks.onPodDuplicate?.(pod.id)}
                onDelete={() => podMenuCallbacks.onPodDelete?.(pod.id)}
                editors={podMenuCallbacks.editors}
                workspaces={podMenuCallbacks.workspaces}
                onOpenInEditor={(editorId) => podMenuCallbacks.onPodOpenInEditor?.(pod.id, editorId)}
                onMoveToWorkspace={(workspaceId) => podMenuCallbacks.onPodMoveToWorkspace?.(pod.id, workspaceId)}
                onSaveAsTemplate={() => podMenuCallbacks.onPodSaveAsTemplate?.(pod.id)}
                onBranchOff={() => podMenuCallbacks.onPodBranchOff?.(pod.id)}
                onSettings={podMenuCallbacks.onPodSettings ? () => podMenuCallbacks.onPodSettings?.(pod.id) : undefined}
              >
                {sortable}
              </PodContextMenu>
            )
          }}
        />
      </SortableContext>
    </DndContext>
  )
}
