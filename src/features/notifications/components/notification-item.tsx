import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { focusPodAgent } from '@/features/workspace/utils/focus-pod-agent'
import { RiAlertLine, RiCheckboxCircleLine, RiInputMethodLine, RiShieldCheckLine, RiTerminalLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/ui/button'
import { type NotificationOrigin, resolveNotificationOrigin } from '../utils/notification-origin'

interface NotificationPayload {
  requestId?: number
  type?: string
  command?: string
  runId?: string
  nodeRunId?: string
  portSlug?: string
  streamId?: string
  code?: number
}

export interface Notification {
  id: string
  type: string
  priority: string
  podId: string | null
  podTerminalId: string | null
  workspaceId: string | null
  title: string
  body: string | null
  payload: NotificationPayload | null
  createdAt: Date | string
  readAt: Date | string | null
  resolvedAt: Date | string | null
  resolution: string | null
}

function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

const typeConfig: Record<string, { icon: typeof RiShieldCheckLine; color: string }> = {
  'agent:permission-request': { icon: RiShieldCheckLine, color: 'text-amber-400' },
  'workflow:input-required': { icon: RiInputMethodLine, color: 'text-blue-400' },
  'terminal:exit': { icon: RiTerminalLine, color: 'text-red-400' },
  'workflow:run-failed': { icon: RiAlertLine, color: 'text-red-400' },
  'workflow:run-completed': { icon: RiCheckboxCircleLine, color: 'text-emerald-400' },
}

const resolutionLabels: Record<string, { label: string; color: string }> = {
  accepted: { label: 'Approved', color: 'text-emerald-400 bg-emerald-400/10' },
  acceptForSession: { label: 'Approved', color: 'text-emerald-400 bg-emerald-400/10' },
  declined: { label: 'Denied', color: 'text-red-400 bg-red-400/10' },
  decline: { label: 'Denied', color: 'text-red-400 bg-red-400/10' },
  dismissed: { label: 'Dismissed', color: 'text-zinc-400 bg-zinc-400/10' },
  'input-provided': { label: 'Responded', color: 'text-blue-400 bg-blue-400/10' },
}

export function NotificationItem({
  notification,
  onResolved,
}: {
  notification: Notification
  onResolved?: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setActivePodId = useUIStore((s) => s.setActivePodId)
  const setInboxOpen = useUIStore((s) => s.setInboxOpen)

  const config = typeConfig[notification.type] ?? { icon: RiAlertLine, color: 'text-zinc-400' }
  const Icon = config.icon
  const isResolved = !!notification.resolvedAt
  const origin: NotificationOrigin = resolveNotificationOrigin(notification)

  const respondToPermissionMutation = useMutation({
    ...orpcUtils.agent.respondToPermission.mutationOptions(),
    onSuccess: () => {
      onResolved?.()
    },
  })

  const resolveNotificationMutation = useMutation({
    ...orpcUtils.notification.resolve.mutationOptions(),
    onSuccess: () => {
      onResolved?.()
    },
  })

  function handleApprove() {
    if (origin.kind !== 'agent-mcp') return
    respondToPermissionMutation.mutate({ requestId: origin.requestId, decision: 'accept' })
  }

  function handleDeny() {
    if (origin.kind !== 'agent-mcp') return
    respondToPermissionMutation.mutate({ requestId: origin.requestId, decision: 'decline' })
  }

  function handleDismiss() {
    resolveNotificationMutation.mutate({ id: notification.id, resolution: 'dismissed' })
  }

  /**
   * Click-to-focus. Behavior depends on the notification's origin (see
   * notification-origin.ts):
   *
   * - agent-terminal: navigate to the pod and focus the specific terminal so
   *   the user can answer the TUI prompt inline.
   * - agent-mcp: navigate to the pod (no specific terminal — MCP requests
   *   don't identify one). Approve/Deny buttons are the real resolution path.
   * - pod: navigate to the pod.
   * - global: no-op.
   *
   * Always closes the inbox drawer when a navigation happens.
   */
  function handleFocus() {
    if (origin.kind === 'global') return
    const podId = origin.podId
    if (!podId) return
    setActivePodId(podId)
    navigate({ to: '/pods/$podId', params: { podId } })
    if (origin.kind === 'agent-terminal') {
      focusPodAgent(queryClient, podId, { by: 'terminalId', podTerminalId: origin.podTerminalId })
    }
    setInboxOpen(false)
  }

  function renderActions() {
    if (isResolved) return null

    switch (notification.type) {
      case 'agent:permission-request':
        // Approve/Deny are only meaningful for the MCP path, where we have a
        // structured resolver via orpc.agent.respondToPermission. The terminal
        // path (Claude Code / Codex CLI / OpenCode TUI) has no response
        // channel — the user has to answer inside the TUI, so we just offer
        // Dismiss and rely on click-to-focus to get them there.
        return (
          <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
            {origin.kind === 'agent-mcp' && (
              <>
                <Button
                  type="button"
                  size="xs"
                  onClick={handleApprove}
                  disabled={respondToPermissionMutation.isPending}
                  className="h-5 px-2 text-[10px] bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={handleDeny}
                  disabled={respondToPermissionMutation.isPending}
                  className="h-5 px-2 text-[10px] bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700"
                >
                  Deny
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleDismiss}
              disabled={resolveNotificationMutation.isPending}
              className="h-5 px-2 text-[10px] bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700"
            >
              Dismiss
            </Button>
          </div>
        )
      case 'workflow:input-required':
        return (
          <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleDismiss}
              disabled={resolveNotificationMutation.isPending}
              className="h-5 px-2 text-[10px] bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700"
            >
              Dismiss
            </Button>
          </div>
        )
      case 'terminal:exit':
      case 'workflow:run-failed':
      case 'workflow:run-completed':
        return (
          <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handleDismiss}
              disabled={resolveNotificationMutation.isPending}
              className="h-5 px-2 text-[10px] bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700"
            >
              Dismiss
            </Button>
          </div>
        )
      default:
        return null
    }
  }

  const resolution = notification.resolution ? resolutionLabels[notification.resolution] : null
  // Card is click-to-focus when it targets a pod and isn't already resolved.
  const canFocus = !isResolved && origin.kind !== 'global'

  return (
    <div
      className={`px-3 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 ${isResolved ? 'opacity-60' : ''} ${canFocus ? 'cursor-pointer' : ''}`}
      onClick={canFocus ? handleFocus : undefined}
    >
      <div className="flex items-start gap-2">
        <Icon className={`size-3.5 mt-0.5 shrink-0 ${config.color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-200 truncate">{notification.title}</span>
            <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(notification.createdAt)}</span>
          </div>
          {notification.body && <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{notification.body}</p>}
          {resolution && (
            <span className={`inline-block mt-1 px-1.5 py-0.5 text-[9px] font-medium rounded-md ${resolution.color}`}>
              {resolution.label}
            </span>
          )}
          {renderActions()}
        </div>
      </div>
    </div>
  )
}
