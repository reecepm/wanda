/**
 * Discriminator for the two paths a permission-request notification can take.
 *
 * Both paths emit `type: 'agent:permission-request'`, but they have very
 * different capabilities and must not be handled by the same code:
 *
 * - `agent-terminal`: emitted by the PTY approval watcher or agent hook events
 *   (Claude Code, Codex CLI, OpenCode). Always carries a `podTerminalId`.
 *   The approval prompt is rendered inside the TUI, so there is no structured
 *   response channel — we cannot offer Approve/Deny buttons that do anything
 *   real. Clicking should focus the specific agent terminal so the user can
 *   answer inline; auto-resolution happens when the agent fires PostToolUse.
 *
 * - `agent-mcp`: emitted by `agentService.onPermissionRequest` via the
 *   JSON-RPC permission bridge (today: Codex's MCP session). Carries a
 *   `payload.requestId` and resolves through `orpc.agent.respondToPermission`.
 *   `podTerminalId` is not set because the request is session-scoped, not
 *   terminal-scoped. Approve/Deny buttons are meaningful here.
 *
 * Non-permission notifications fall through to `pod` (scoped to a pod) or
 * `global` (unscoped), which just drives click-to-navigate behavior.
 */
export type NotificationOrigin =
  | { kind: 'agent-terminal'; podId: string | null; podTerminalId: string }
  | { kind: 'agent-mcp'; podId: string | null; requestId: number }
  | { kind: 'pod'; podId: string }
  | { kind: 'global' }

export interface NotificationLike {
  type: string
  podId?: string | null
  podTerminalId?: string | null
  payload?: { requestId?: unknown } | null
}

export function resolveNotificationOrigin(notification: NotificationLike): NotificationOrigin {
  if (notification.type === 'agent:permission-request') {
    if (notification.podTerminalId) {
      return {
        kind: 'agent-terminal',
        podId: notification.podId ?? null,
        podTerminalId: notification.podTerminalId,
      }
    }
    const requestId = notification.payload?.requestId
    if (typeof requestId === 'number') {
      return {
        kind: 'agent-mcp',
        podId: notification.podId ?? null,
        requestId,
      }
    }
  }
  if (notification.podId) {
    return { kind: 'pod', podId: notification.podId }
  }
  return { kind: 'global' }
}
