const statusConfig: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' },
  ready: { label: 'Ready', className: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  in_progress: { label: 'In Progress', className: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  completed: { label: 'Completed', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-400 border-red-500/30' },
  blocked: { label: 'Blocked', className: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
}

export function TaskStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] ?? { label: status, className: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${config.className}`}
    >
      {config.label}
    </span>
  )
}
