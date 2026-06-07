import { type PodItem, useViewStore } from '@/features/view'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'

/**
 * Create a new markdown-editor pod item. The caller should have already
 * resolved a relative file path (e.g. via orpc.file.pickMarkdownFile).
 *
 * The caller is responsible for the view-specific layout step
 * (e.g. splitPane, addTabToPane, etc.) and calling onItemsChanged().
 */
export async function createMarkdownItem(podId: string, relPath: string): Promise<PodItem | null> {
  const label = basename(relPath) || 'Untitled.md'
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const item = await client.podItem.create({
    podId: realPodId,
    contentType: 'markdown',
    label,
    config: { filePath: relPath },
  })
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find((pi: { id: string }) => pi.id === item.id)
  if (newPodItem) {
    useViewStore.getState().updatePodItems(updatedItems)
    return newPodItem
  }
  return null
}

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}
