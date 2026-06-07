// -----------------------------------------------------------------------------
// Agent-status webhook.
//
// Hooks injected into agent processes POST here from inside those processes.
// The handler runs BEFORE the RPC auth gate, so it self-authenticates with
// the per-server hook token (see `hook-token.ts`). Payloads arrive in two
// shapes — Wanda's normalised camelCase shape and Claude/Codex native
// snake_case hook payloads — both reduced to `AgentStatusEvent` here.
// -----------------------------------------------------------------------------

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import type { NotificationEmitInput } from '../domains/notification/controller/notifications'
import type { AgentStatusEvent, AgentStatusServiceShape } from '../packages/agent-hooks'
import { log } from '../packages/logger'
import type { HookTokenGuard } from './hook-token'

/**
 * Coerce a raw POST body into an `AgentStatusEvent`. Accepts:
 *  - Wanda's normalised shape (camelCase fields), used by command-type Codex
 *    hooks and the legacy bash script.
 *  - Claude's native HTTP-hook payload (`hook_event_name`, `session_id`,
 *    `tool_name`, `tool_input.{command|file_path|pattern}`), where the Wanda
 *    terminal/agent identity arrives via `X-Wanda-Terminal-Id` /
 *    `X-Wanda-Agent-Type` headers (env-substituted at hook fire time).
 */
export function normaliseAgentStatusEvent(
  raw: Record<string, unknown>,
  headers: IncomingHttpHeaders,
): AgentStatusEvent {
  const headerStr = (k: string): string | undefined => {
    const v = headers[k.toLowerCase()]
    return Array.isArray(v) ? v[0] : (v ?? undefined)
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

  const toolInput = (raw.tool_input ?? raw.toolInput) as Record<string, unknown> | undefined
  const toolCmd =
    str(raw.toolCommand) ?? str(toolInput?.command) ?? str(toolInput?.file_path) ?? str(toolInput?.pattern)

  return {
    event: str(raw.event) ?? str(raw.hook_event_name) ?? '',
    terminalId: str(raw.terminalId) ?? headerStr('X-Wanda-Terminal-Id'),
    sessionId: str(raw.sessionId) ?? str(raw.session_id),
    cwd: str(raw.cwd),
    agentType:
      (str(raw.agentType) as AgentStatusEvent['agentType']) ??
      (headerStr('X-Wanda-Agent-Type') as AgentStatusEvent['agentType']),
    timestamp: num(raw.timestamp),
    turnId: str(raw.turnId) ?? str(raw.turn_id),
    toolName: str(raw.toolName) ?? str(raw.tool_name),
    toolCommand: toolCmd,
    detail: (raw.detail as Record<string, unknown> | undefined) ?? undefined,
  }
}

export interface AgentStatusWebhookDeps {
  readonly hookToken: HookTokenGuard
  readonly agentStatusService: AgentStatusServiceShape
  readonly emitNotification: (input: NotificationEmitInput) => void
  readonly resolvePendingPermissionsForTerminal: (terminalId: string) => Promise<number>
  readonly terminalToPodId: (terminalId: string) => string | null | undefined
  readonly onPermissionsResolved: () => void
  readonly onRepoChanged: (cwd: string) => void
}

/**
 * Build the POST `/agent-status` handler. Returns a function that consumes the
 * request body and replies. The caller is responsible for routing only
 * `POST /agent-status` requests here.
 */
export function makeAgentStatusWebhook(deps: AgentStatusWebhookDeps) {
  const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  return function handleAgentStatus(req: IncomingMessage, res: ServerResponse): void {
    const providedToken = req.headers['x-wanda-hook-token']
    if (!deps.hookToken.matches(Array.isArray(providedToken) ? providedToken[0] : providedToken)) {
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('unauthorized')
      return
    }
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      try {
        const raw = JSON.parse(body) as Record<string, unknown>
        // Accept both Wanda's normalised shape and Claude/Codex native hook payloads.
        // Native payloads use snake_case (`hook_event_name`, `session_id`, `tool_name`,
        // `tool_input.command|file_path|pattern`). HTTP hooks identify the Wanda
        // terminal/agent via X-Wanda-* headers (env-substituted at hook time).
        const event = normaliseAgentStatusEvent(raw, req.headers)
        if (!event.event || (!event.terminalId && !event.sessionId)) {
          writeJson(res, 400, { ok: false, error: 'missing event or identifier (terminalId/sessionId)' })
          return
        }

        // Permission-request events become notifications (not status updates).
        const isPermissionRequest = event.event === 'PermissionRequest' || event.event === 'permission.asked'
        if (isPermissionRequest && event.terminalId) {
          const terminalId = event.terminalId
          const podId = deps.terminalToPodId(terminalId)
          deps.emitNotification({
            type: 'agent:permission-request',
            priority: 'blocking',
            podId: podId ?? undefined,
            podTerminalId: terminalId,
            title: `Agent permission: ${event.toolName ?? 'action'}`,
            body: event.toolCommand ?? undefined,
            payload: {
              source: 'hook',
              toolName: event.toolName,
              command: event.toolCommand,
              sessionId: event.sessionId,
            },
          })
          writeJson(res, 200, { ok: true })
          return
        }

        // "Proceeding" events imply any outstanding permission request on
        // this terminal has been satisfied — resolve pending permissions
        // scoped to the terminal.
        const isProceedingEvent =
          event.event === 'PostToolUse' ||
          event.event === 'PostToolUseFailure' ||
          event.event === 'tool.execute.after' ||
          event.event === 'Stop' ||
          event.event === 'SessionEnd' ||
          event.event === 'session.idle' ||
          event.event === 'turn/completed'
        if (isProceedingEvent && event.terminalId) {
          const terminalId = event.terminalId
          void deps
            .resolvePendingPermissionsForTerminal(terminalId)
            .then((count) => {
              if (count > 0) deps.onPermissionsResolved()
            })
            .catch((err) => log.main.warn('permission resolution failed:', err))
        }

        // Agent-driven refresh hints → immediate git-status refresh for
        // the pod's repo. Faster than waiting for the 2s poll tick.
        //   - Claude `FileChanged`: the direct signal when Claude writes.
        //   - `PostToolUse` (Claude + Codex): proxy for "a tool ran, state
        //     may have changed". Covers codex, which has no FileChanged.
        // Fingerprint gating + in-flight dedup in the broadcaster means a
        // redundant nudge is essentially free.
        const evLower = event.event.toLowerCase()
        const isFileHint =
          evLower === 'filechanged' ||
          evLower === 'file_changed' ||
          evLower === 'posttooluse' ||
          evLower === 'post_tool_use'
        if (isFileHint && event.cwd) {
          deps.onRepoChanged(event.cwd)
        }

        deps.agentStatusService.update(event)
        writeJson(res, 200, { ok: true })
      } catch {
        writeJson(res, 400, { ok: false, error: 'invalid json' })
      }
    })
  }
}
