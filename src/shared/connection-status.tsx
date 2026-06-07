// Connection status hook + indicator.
//
// Subscribes to app transport status and shell reconnect events to drive:
//   1. A fixed-position badge in the top-right when the renderer is
//      reconnecting or disconnected.
//   2. A TanStack Query cache invalidation whenever the transport comes
//      back from a disconnect OR the server subprocess restarts.
//
// The badge is intentionally minimal — it's a "something's wrong"
// indicator, not a full connection-management UI.

import { useActivePairedStatuses } from '@/features/servers/use-paired-status'
import { useServers } from '@/features/servers/use-servers'
import { useConnectionStatus } from '@/shared/use-connection-status'

type BadgeTone = 'warning' | 'error'
interface StatusBadge {
  key: string
  label: string
  tone: BadgeTone
}

/**
 * Fixed-position badge stack for the local transport plus any paired
 * server whose bridge is live but not currently connected. Local state
 * drives a generic "server" badge; paired servers each get their own
 * labelled entry. Only servers the user has actually opened (bridge
 * constructed) appear — paired entries that were never touched stay
 * silent.
 */
export function ConnectionStatusIndicator(): React.ReactNode {
  const localStatus = useConnectionStatus()
  const pairedStatuses = useActivePairedStatuses()
  const { data: servers = [] } = useServers()

  const badges: StatusBadge[] = []

  if (localStatus === 'reconnecting') {
    badges.push({ key: 'local', label: 'Reconnecting to server…', tone: 'warning' })
  } else if (localStatus === 'disconnected') {
    badges.push({ key: 'local', label: 'Disconnected from server', tone: 'error' })
  }

  const labelFor = (registryId: string): string => {
    const srv = servers.find((s) => s.id === registryId)
    return srv?.label ?? srv?.serverId ?? registryId
  }

  for (const { registryId, status } of pairedStatuses) {
    const name = labelFor(registryId)
    if (status === 'reconnecting' || status === 'recovering' || status === 'connecting') {
      badges.push({ key: `paired:${registryId}`, label: `Reconnecting to ${name}…`, tone: 'warning' })
    } else if (status === 'offline' || status === 'unpaired' || status === 'stopped') {
      const reason =
        status === 'unpaired' ? `Unpaired from ${name}` : status === 'stopped' ? `${name} stopped` : `Offline — ${name}`
      badges.push({ key: `paired:${registryId}`, label: reason, tone: 'error' })
    }
  }

  if (badges.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 10_000,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {badges.map((b) => (
        <StatusBadgeRow key={b.key} tone={b.tone} label={b.label} />
      ))}
      <style>{`@keyframes wanda-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  )
}

function StatusBadgeRow({ tone, label }: { tone: BadgeTone; label: string }): React.ReactNode {
  const color = tone === 'warning' ? 'oklch(0.68 0.14 75)' : 'oklch(0.62 0.20 25)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 6,
        background: 'oklch(0.20 0.01 260 / 0.92)',
        color: '#e4e4e7',
        fontSize: 12,
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        border: `1px solid ${color}`,
        backdropFilter: 'blur(6px)',
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: color,
          animation: tone === 'warning' ? 'wanda-pulse 1s ease-in-out infinite' : 'none',
        }}
      />
      <span>{label}</span>
    </div>
  )
}
