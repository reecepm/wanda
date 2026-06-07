import { getPodColor, type PodColor } from '@/features/view/scope/pod-colors'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import { useAppearanceStore } from '@/stores/appearance-store'

/** Returns the pod's color if pod color coding is enabled (workspace+ scopes), or null. */
export function usePodColor(podId: string | undefined): PodColor | null {
  const { pods, config } = useViewScope()
  const accentColor = useAppearanceStore((s) => s.accentColor)
  if (!config.visual.showPodColorCoding || !podId || !pods) return null
  const index = pods.findIndex((p) => p.id === podId)
  return index >= 0 ? getPodColor(index, accentColor) : null
}
