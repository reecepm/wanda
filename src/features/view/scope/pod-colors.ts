export interface PodColor {
  name: string
  border: string
  bg: string
  text: string
  hex: string
}

const ALL_POD_COLORS: PodColor[] = [
  { name: 'blue', border: 'border-blue-500', bg: 'bg-blue-500/10', text: 'text-blue-400', hex: '#3b82f6' },
  { name: 'emerald', border: 'border-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-400', hex: '#10b981' },
  { name: 'amber', border: 'border-amber-500', bg: 'bg-amber-500/10', text: 'text-amber-400', hex: '#f59e0b' },
  { name: 'purple', border: 'border-purple-500', bg: 'bg-purple-500/10', text: 'text-purple-400', hex: '#a855f7' },
  { name: 'rose', border: 'border-rose-500', bg: 'bg-rose-500/10', text: 'text-rose-400', hex: '#f43f5e' },
  { name: 'cyan', border: 'border-cyan-500', bg: 'bg-cyan-500/10', text: 'text-cyan-400', hex: '#06b6d4' },
  { name: 'orange', border: 'border-orange-500', bg: 'bg-orange-500/10', text: 'text-orange-400', hex: '#f97316' },
  { name: 'pink', border: 'border-pink-500', bg: 'bg-pink-500/10', text: 'text-pink-400', hex: '#ec4899' },
]

/** Get pod colors filtered to exclude the user's focus accent color. */
export function getAvailablePodColors(accentColor: string): PodColor[] {
  return ALL_POD_COLORS.filter((c) => c.name !== accentColor)
}

/** Get a stable color for a pod based on its index, excluding the user's accent color. */
export function getPodColor(podIndex: number, accentColor?: string): PodColor {
  const colors = accentColor ? getAvailablePodColors(accentColor) : ALL_POD_COLORS
  return colors[podIndex % colors.length] ?? ALL_POD_COLORS[0]!
}

export { ALL_POD_COLORS as POD_COLORS }
