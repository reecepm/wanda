import { InvalidTransitionError } from './errors.ts'
import type { TaskStatus } from './types.ts'

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  draft: ['pending', 'ready'],
  pending: ['ready'],
  ready: ['in_progress'],
  in_progress: ['completed', 'failed', 'blocked', 'ready'],
  blocked: ['ready', 'in_progress'],
  completed: [],
  failed: ['ready'],
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export function isTerminal(status: TaskStatus): boolean {
  return TRANSITIONS[status].length === 0
}
