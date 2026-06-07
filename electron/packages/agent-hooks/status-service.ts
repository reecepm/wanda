import { EventEmitter } from 'node:events'
import { Context, Layer } from 'effect'
import type { AgentType } from '../../domains/pod/types'
import { log } from '../logger'

// ── Types ──────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'working' | 'error' | 'stopped'

export interface AgentStatusEntry {
  podTerminalId: string
  agentType: AgentType
  cwd: string
  status: AgentStatus
  lastEvent: string
  lastEventTime: number
  sessionId?: string
  errorDetail?: string
  /** PTY exit code captured when the agent terminal exited. */
  exitCode?: number
  /**
   * Tail of the agent terminal's output captured when it exited. Used by
   * the renderer's AgentStoppedView to show *why* the CLI process died
   * (rate limit, auth failure, context overflow, etc.).
   */
  exitOutput?: string
}

export interface AgentStatusEvent {
  terminalId?: string
  sessionId?: string
  cwd?: string
  event: string
  agentType?: AgentType
  timestamp?: number
  turnId?: string
  toolName?: string
  toolCommand?: string
  detail?: Record<string, unknown>
}

// ── Event → Status mapping ─────────────────────────────────────────

const IDLE_EVENTS = new Set([
  'Stop',
  'SessionEnd',
  'SessionStart',
  'TeammateIdle',
  'session.idle',
  'session.created',
  'session_end',
  'session_start',
  'idle',
  'turn/completed',
])

const WORKING_EVENTS = new Set(['PreToolUse', 'UserPromptSubmit', 'tool.execute.before', 'working'])

const ERROR_EVENTS = new Set(['PostToolUseFailure', 'StopFailure', 'session.error', 'error'])

function mapEventToStatus(event: string): AgentStatus | null {
  if (IDLE_EVENTS.has(event)) return 'idle'
  if (WORKING_EVENTS.has(event)) return 'working'
  if (ERROR_EVENTS.has(event)) return 'error'
  if (event === 'PostToolUse' || event === 'tool.execute.after') return 'working'
  return null
}

// ── Service shape ──────────────────────────────────────────────────

export interface AgentStatusServiceShape {
  readonly update: (event: AgentStatusEvent) => void
  readonly get: (terminalId: string) => AgentStatusEntry | undefined
  readonly getAll: () => AgentStatusEntry[]
  readonly register: (terminalId: string, agentType: AgentType, cwd: string) => void
  readonly markStopped: (terminalId: string, info?: { exitCode?: number; exitOutput?: string }) => void
  readonly unregister: (terminalId: string) => void
  readonly onChange: (callback: (terminalId: string, entry: AgentStatusEntry) => void) => () => void
}

export class AgentStatusService extends Context.Tag('AgentStatusService')<
  AgentStatusService,
  AgentStatusServiceShape
>() {}

export const AgentStatusServiceLive = Layer.sync(AgentStatusService, () => {
  const entries = new Map<string, AgentStatusEntry>()
  const sessionMap = new Map<string, string>()
  const completedTurnsByTerminal = new Map<string, string[]>()
  const emitter = new EventEmitter()

  function emit(terminalId: string, entry: AgentStatusEntry) {
    emitter.emit('change', terminalId, entry)
  }

  function resolveTerminalId(event: AgentStatusEvent): string | undefined {
    if (event.terminalId) {
      if (event.sessionId) sessionMap.set(event.sessionId, event.terminalId)
      return event.terminalId
    }

    if (event.sessionId) {
      const cached = sessionMap.get(event.sessionId)
      if (cached) return cached
    }

    if (event.sessionId && event.cwd) {
      for (const entry of entries.values()) {
        if (
          entry.cwd === event.cwd &&
          (!event.agentType || entry.agentType === event.agentType) &&
          !entry.sessionId &&
          entry.status !== 'stopped'
        ) {
          sessionMap.set(event.sessionId, entry.podTerminalId)
          log.pod.info(`Matched session ${event.sessionId} to terminal ${entry.podTerminalId} via cwd=${event.cwd}`)
          return entry.podTerminalId
        }
      }
    }

    return undefined
  }

  function applyStatus(terminalId: string, entry: AgentStatusEntry, newStatus: AgentStatus, event: AgentStatusEvent) {
    if (newStatus === 'working' && event.turnId) {
      const completedTurns = completedTurnsByTerminal.get(terminalId) ?? []
      if (completedTurns.includes(event.turnId)) return
    }

    const changed = entry.status !== newStatus
    entry.status = newStatus
    entry.lastEvent = event.event
    entry.lastEventTime = event.timestamp ?? Date.now()
    if (event.sessionId) entry.sessionId = event.sessionId

    if (newStatus === 'idle' && event.turnId) {
      const completedTurns = completedTurnsByTerminal.get(terminalId) ?? []
      if (!completedTurns.includes(event.turnId)) {
        completedTurns.push(event.turnId)
        completedTurnsByTerminal.set(terminalId, completedTurns.slice(-32))
      }
    }

    if (newStatus === 'error') {
      entry.errorDetail = typeof event.detail?.message === 'string' ? event.detail.message : undefined
    } else {
      entry.errorDetail = undefined
    }

    if (changed) emit(terminalId, entry)
  }

  return {
    update(event) {
      const terminalId = resolveTerminalId(event)
      if (!terminalId) return

      const entry = entries.get(terminalId)
      if (!entry) return
      if (entry.status === 'stopped') return

      const newStatus = mapEventToStatus(event.event)
      if (!newStatus) return

      applyStatus(terminalId, entry, newStatus, event)
    },

    get(terminalId) {
      return entries.get(terminalId)
    },

    getAll() {
      return [...entries.values()]
    },

    register(terminalId, agentType, cwd) {
      const entry: AgentStatusEntry = {
        podTerminalId: terminalId,
        agentType,
        cwd,
        status: 'idle',
        lastEvent: 'registered',
        lastEventTime: Date.now(),
      }
      entries.set(terminalId, entry)
      emit(terminalId, entry)
    },

    markStopped(terminalId, info) {
      const entry = entries.get(terminalId)
      if (!entry) return
      entry.status = 'stopped'
      entry.lastEvent = 'pty_exit'
      entry.lastEventTime = Date.now()
      if (info?.exitCode !== undefined) entry.exitCode = info.exitCode
      if (info?.exitOutput !== undefined) entry.exitOutput = info.exitOutput
      emit(terminalId, entry)
    },

    unregister(terminalId) {
      const entry = entries.get(terminalId)
      if (entry?.sessionId) sessionMap.delete(entry.sessionId)
      completedTurnsByTerminal.delete(terminalId)
      entries.delete(terminalId)
    },

    onChange(callback) {
      emitter.on('change', callback)
      return () => emitter.off('change', callback)
    },
  }
})
