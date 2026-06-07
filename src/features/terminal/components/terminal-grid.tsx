import { TerminalStatusBadge } from './terminal-status-badge'
import { TerminalView } from './terminal-view'

interface TerminalPane {
  id: string
  label: string
  status: 'running' | 'stopped' | 'crashed'
  machine?: string
}

interface TerminalGridProps {
  panes: TerminalPane[]
  columns?: 1 | 2 | 3 | 4
}

const gridCols = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
} as const

export function TerminalGrid({ panes, columns = 2 }: TerminalGridProps) {
  return (
    <div className={`grid ${gridCols[columns]} gap-2 h-full`}>
      {panes.map((pane) => (
        <div key={pane.id} className="flex flex-col border border-zinc-800 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <TerminalStatusBadge status={pane.status} />
              <span className="text-xs font-mono text-zinc-400">{pane.label}</span>
            </div>
            {pane.machine && <span className="text-xs text-zinc-600">{pane.machine}</span>}
          </div>
          <div className="flex-1 min-h-0">
            <TerminalView terminalId={pane.id} />
          </div>
        </div>
      ))}
    </div>
  )
}
