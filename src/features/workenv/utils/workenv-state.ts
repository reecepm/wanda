// State → display metadata. Source of truth for badge colours, dot
// styles, and human-readable labels across the Workenvs UI.

import type { WorkenvState } from '@/types/schema'

export const WORKENV_STATE_LABELS: Record<WorkenvState, string> = {
  creating: 'Creating',
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  destroyed: 'Destroyed',
  error: 'Error',
  stranded: 'Stranded',
}

/**
 * Tailwind classes for the small status dot (1.5–2u square). Pulse on
 * transitional states so the user sees motion while the controller is
 * waiting on the adapter.
 */
export const WORKENV_STATE_DOT_COLORS: Record<WorkenvState, string> = {
  creating: 'bg-amber-400 animate-pulse',
  stopped: 'bg-zinc-600',
  starting: 'bg-amber-400 animate-pulse',
  running: 'bg-emerald-500',
  stopping: 'bg-amber-400 animate-pulse',
  destroyed: 'bg-zinc-700',
  error: 'bg-red-500',
  stranded: 'bg-zinc-500',
}

/** Pill (badge) classes — text + bg paired so the badge renders cleanly. */
export const WORKENV_STATE_BADGE_COLORS: Record<WorkenvState, string> = {
  creating: 'text-amber-300 bg-amber-950/40 border-amber-900/60',
  stopped: 'text-zinc-300 bg-zinc-900/60 border-zinc-800',
  starting: 'text-amber-300 bg-amber-950/40 border-amber-900/60',
  running: 'text-emerald-300 bg-emerald-950/40 border-emerald-900/60',
  stopping: 'text-amber-300 bg-amber-950/40 border-amber-900/60',
  destroyed: 'text-zinc-500 bg-zinc-950/60 border-zinc-900',
  error: 'text-red-300 bg-red-950/40 border-red-900/60',
  stranded: 'text-zinc-400 bg-zinc-900/60 border-zinc-800',
}

/** Whether the state allows a `start` action right now. */
export function canStart(state: WorkenvState): boolean {
  return state === 'stopped' || state === 'error'
}

/** Whether the state allows a `stop` action right now. */
export function canStop(state: WorkenvState): boolean {
  return state === 'running'
}

/** Whether the state allows a `destroy` action right now. */
export function canDestroy(state: WorkenvState): boolean {
  return state !== 'destroyed'
}

/** Whether the state should disable interactive controls (transition in flight). */
export function isTransitioning(state: WorkenvState): boolean {
  return state === 'creating' || state === 'starting' || state === 'stopping'
}
