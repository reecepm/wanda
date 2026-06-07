export type AgentStatus = 'working' | 'idle' | 'error' | 'stopped'

export const AGENT_STATUS_DOT: Record<AgentStatus, string> = {
  working: 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.35)]',
  idle: 'bg-zinc-500',
  error: 'bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.4)]',
  stopped: 'bg-zinc-700',
}

/** Pulsing amber dot shown on any agent that has an outstanding attention request,
 * regardless of its underlying working/idle status. Attention lives in notifications,
 * not the status scalar, so this is applied independently. */
export const AGENT_ATTENTION_DOT = 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.4)] animate-pulse'

export const POD_STATUS_DOT: Record<string, string> = {
  running: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]',
  stopped: 'bg-zinc-600',
  failed: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)]',
  starting: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)] animate-pulse',
  stopping: 'bg-zinc-500 animate-pulse',
}
