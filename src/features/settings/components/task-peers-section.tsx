import { SectionHeader } from '@/layout/section-header'

/**
 * Placeholder for remote task peer connections.
 *
 * Tasks are now managed locally by @wanda/tasks. Remote peer discovery
 * (connecting to other Wanda instances) will be added here later.
 */
export function TaskPeersSection() {
  return (
    <div>
      <SectionHeader
        title="Task Peers"
        description="Tasks are now managed locally. Remote peer connections will be configurable here in a future update."
      />

      <div className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center">
        <p className="text-xs text-zinc-500">No peers configured</p>
      </div>
    </div>
  )
}
