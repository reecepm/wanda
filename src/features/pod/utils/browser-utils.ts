import { type PodItem, useViewStore } from '@/features/view'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'

/**
 * Create a new browser pod item, fetch updated pod items,
 * and return the new PodItem (or null if not found).
 *
 * The caller is responsible for the view-specific layout step
 * (e.g. splitPane, addTabToPane, etc.) and calling onTerminalsChanged().
 */
export async function createBrowserItem(
  podId: string,
  opts?: { url?: string; label?: string },
): Promise<PodItem | null> {
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  const item = await client.podItem.create({
    podId: realPodId,
    contentType: 'browser',
    label: opts?.label ?? 'New Browser',
    config: { url: opts?.url ?? '' },
  })
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find((pi) => pi.id === item.id)
  if (newPodItem) {
    useViewStore.getState().updatePodItems(updatedItems)
    return newPodItem
  }
  return null
}
