interface TerminalStatusBadgeProps {
  status: 'running' | 'stopped' | 'crashed'
}

const statusConfig = {
  running: { color: 'bg-green-500', label: 'Running' },
  stopped: { color: 'bg-zinc-500', label: 'Stopped' },
  crashed: { color: 'bg-red-500', label: 'Crashed' },
} as const

export function TerminalStatusBadge({ status }: TerminalStatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span className="flex items-center gap-1.5" title={config.label}>
      <span className={`inline-block h-2 w-2 rounded-full ${config.color}`} />
    </span>
  )
}
