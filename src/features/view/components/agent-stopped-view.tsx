import { useAgentStatuses } from '@/features/workspace'
import { RiRobot2Line } from '@/lib/icons'
import type { AgentItemConfig, ViewItem } from '@/types/schema'

interface AgentStoppedViewProps {
  item: ViewItem
  onRestart?: () => void
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

export function AgentStoppedView({ item, onRestart }: AgentStoppedViewProps) {
  const config = item.config as AgentItemConfig
  const label = AGENT_LABELS[config.agentType] ?? config.agentType
  const { getStatus, statusMap } = useAgentStatuses()
  // Read via the map so the component re-renders when exitOutput lands after
  // the initial `stopped` transition. `getStatus` is useCallback-stable and
  // wouldn't retrigger on its own.
  const status = statusMap.get(config.podTerminalId) ?? getStatus(config.podTerminalId)

  const exitCode = status?.exitCode
  const exitOutput = status?.exitOutput?.trim()
  const exitSummary = (() => {
    if (exitCode === undefined) return null
    if (exitCode === 0) return 'Exited normally'
    if (exitCode > 128) return `Killed by signal ${exitCode - 128}`
    return `Exited with code ${exitCode}`
  })()

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <RiRobot2Line className="h-8 w-8 text-zinc-700 mb-3" />
      <p className="text-sm text-zinc-400 mb-1">{item.label}</p>
      <p className="text-xs text-zinc-600 mb-1">
        {label} agent stopped{exitSummary ? ` — ${exitSummary}` : ''}
      </p>
      {exitOutput && (
        <pre className="mt-2 mb-3 max-w-lg max-h-48 overflow-auto whitespace-pre-wrap break-words text-left font-mono text-[10px] leading-snug text-zinc-500 bg-zinc-900/50 border border-zinc-800 rounded-md px-2 py-1.5">
          {exitOutput}
        </pre>
      )}
      {onRestart && (
        <button
          type="button"
          onClick={onRestart}
          className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
        >
          Restart
        </button>
      )}
    </div>
  )
}
