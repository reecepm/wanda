import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { RiAlertLine, RiCheckLine, RiCloseLine, RiShieldCheckLine } from '@/lib/icons'
import { formatRelativeTime } from '@/shared/format'
import { orpcUtils } from '@/shared/orpc'
import { useTrayActions } from '../hooks/use-tray-actions'
import { useTrayData } from '../hooks/use-tray-data'

type Notification = ReturnType<typeof useTrayData>['unresolvedNotifications'][number]

const AGENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  claude: ClaudeIcon,
  codex: OpenAIIcon,
  opencode: OpenCodeIcon,
}

export function TrayAttentionSection() {
  const { unresolvedNotifications, workspaces } = useTrayData()
  const { navigateMainWindow } = useTrayActions()
  const queryClient = useQueryClient()
  const respondToPermissionMutation = useMutation({
    ...orpcUtils.agent.respondToPermission.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification'] })
    },
  })

  // Find all agents with outstanding attention requests across all pods. Attention
  // is sourced from unresolved notifications joined by podTerminalId, not from the
  // agent status scalar, so parallel sub-agent status events can't clobber it.
  const waitingAgents = workspaces.flatMap((ws) =>
    ws.pods.flatMap((pod) => pod.agents.filter((a) => a.needsAttention).map((a) => ({ ...a, pod }))),
  )

  // Non-agent attention notifications (workflow input, terminal exits, etc.)
  const otherAttention = unresolvedNotifications.filter(
    (n) => (n.priority === 'blocking' || n.priority === 'urgent') && n.type !== 'agent:permission-request',
  )

  const hasAttention = waitingAgents.length > 0 || otherAttention.length > 0
  if (!hasAttention) return null

  function handleApprove(notification: Notification) {
    const payload = notification.payload as { requestId?: number } | null | undefined
    const requestId = payload?.requestId
    if (typeof requestId !== 'number') return
    respondToPermissionMutation.mutate({ requestId, decision: 'accept' })
  }

  function handleDeny(notification: Notification) {
    const payload = notification.payload as { requestId?: number } | null | undefined
    const requestId = payload?.requestId
    if (typeof requestId !== 'number') return
    respondToPermissionMutation.mutate({ requestId, decision: 'decline' })
  }

  // Match agent attention to its notification for the requestId
  const permissionNotifications = unresolvedNotifications.filter((n) => n.type === 'agent:permission-request')

  return (
    <div className="border-b border-border/50 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-1 px-1 text-[10px] font-medium uppercase tracking-wider text-amber-400/80">
        <RiShieldCheckLine className="size-3" />
        <span>Needs attention</span>
        <span className="ml-auto text-[10px] tabular-nums">{waitingAgents.length + otherAttention.length}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {/* Agent permission requests — rendered like the sidebar */}
        {waitingAgents.map((agent) => {
          const Icon = AGENT_ICON[agent.agentType] ?? ClaudeIcon
          // Find matching notification for approve/deny actions — prefer an exact
          // terminal match so parallel agents in one pod don't bleed into each other.
          const notification =
            permissionNotifications.find((n) => n.podTerminalId === agent.podTerminalId) ??
            permissionNotifications.find((n) => n.podId === agent.pod.id)
          const attentionReason =
            (notification?.body as string | null | undefined) ?? (notification?.title as string | undefined)

          return (
            <div
              key={agent.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
            >
              <div className="shrink-0 mt-0.5">
                <Icon className="size-3.5" />
              </div>

              <button
                type="button"
                onClick={() => navigateMainWindow(`/pods/${agent.pod.id}`)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-[11px] truncate leading-tight">{agent.name}</span>
                {attentionReason && (
                  <span className="block text-[10px] text-amber-400/70 truncate leading-tight">{attentionReason}</span>
                )}
                <span className="block text-[10px] text-muted-foreground truncate leading-tight">{agent.pod.name}</span>
              </button>

              {/* Approve/Deny buttons */}
              {notification &&
                (notification.payload as { requestId?: unknown } | null | undefined)?.requestId != null && (
                  <div className="flex shrink-0 gap-0.5 mt-0.5">
                    <button
                      type="button"
                      onClick={() => handleApprove(notification)}
                      disabled={respondToPermissionMutation.isPending}
                      className="rounded p-0.5 text-emerald-400 hover:bg-emerald-400/10"
                      title="Approve"
                    >
                      <RiCheckLine className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeny(notification)}
                      disabled={respondToPermissionMutation.isPending}
                      className="rounded p-0.5 text-red-400 hover:bg-red-400/10"
                      title="Deny"
                    >
                      <RiCloseLine className="size-3.5" />
                    </button>
                  </div>
                )}
            </div>
          )
        })}

        {/* Other attention notifications */}
        {otherAttention.slice(0, 3).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.podId) navigateMainWindow(`/pods/${item.podId}`)
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/50 transition-colors"
          >
            <RiAlertLine className="size-3.5 shrink-0 text-red-400" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px]">{item.title}</div>
              {item.body && <div className="truncate text-[10px] text-muted-foreground">{item.body}</div>}
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
