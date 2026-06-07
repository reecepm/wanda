import { type PodItem, useViewStore } from '@/features/view'
import { orpcForPod, unwrapPodId } from '@/shared/orpc'
import type { CommandItemConfig } from '@/types/schema'

/**
 * Add an existing command to the view as a pod item.
 * Returns the new PodItem (or null if not found).
 */
export async function createCommandItem(podId: string, podCommandId: string): Promise<PodItem | null> {
  const client = orpcForPod(podId)
  const realPodId = unwrapPodId(podId)
  await client.pod.addCommandToView({ podCommandId })
  const updatedItems = (await client.podItem.list({ podId: realPodId })) as PodItem[]
  const newPodItem = updatedItems.find(
    (pi) => pi.contentType === 'command' && (pi.config as CommandItemConfig).podCommandId === podCommandId,
  )
  if (newPodItem) {
    useViewStore.getState().updatePodItems(updatedItems)
    return newPodItem
  }
  return null
}
