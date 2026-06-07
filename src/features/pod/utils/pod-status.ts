export type PodStatus = 'running' | 'stopped' | 'failed' | 'starting' | 'stopping'

export const POD_STATUS_COLORS: Record<PodStatus, string> = {
  running: 'bg-emerald-400',
  stopped: 'bg-zinc-500',
  failed: 'bg-red-400',
  starting: 'bg-amber-400 animate-pulse',
  stopping: 'bg-zinc-400 animate-pulse',
}

export const POD_STATUS_LABELS: Record<PodStatus, string> = {
  running: 'Running',
  stopped: 'Stopped',
  failed: 'Failed',
  starting: 'Starting...',
  stopping: 'Stopping...',
}

export type BuildStatus = 'success' | 'building' | 'pending' | 'failed'

export const BUILD_STATUS_COLORS: Record<BuildStatus, string> = {
  success: 'bg-emerald-400',
  building: 'bg-amber-400 animate-pulse',
  pending: 'bg-zinc-400 animate-pulse',
  failed: 'bg-red-400',
}

export const BUILD_STATUS_CONFIG: Record<BuildStatus, { color: string; text: string; textColor: string }> = {
  success: { color: 'bg-emerald-400', text: 'Built', textColor: 'text-emerald-400' },
  building: { color: 'bg-amber-400 animate-pulse', text: 'Building', textColor: 'text-amber-400' },
  pending: { color: 'bg-amber-400 animate-pulse', text: 'Pending', textColor: 'text-amber-400' },
  failed: { color: 'bg-red-400', text: 'Failed', textColor: 'text-red-400' },
}
