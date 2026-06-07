// -----------------------------------------------------------------------------
// Exponential backoff schedule for the reconnect FSM.
//
// Spec §5.1: 1s, 2s, 4s, 8s, 16s, 32s, 32s, ... Reset to 1s on every
// successful hello-ack.
// -----------------------------------------------------------------------------

export const DEFAULT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000]

export function pickBackoff(schedule: readonly number[], attempt: number): number {
  if (schedule.length === 0) return 0
  const idx = Math.min(Math.max(attempt, 1), schedule.length) - 1
  return schedule[idx]!
}
