import { POD_STATUS_COLORS, POD_STATUS_LABELS } from '@/features/pod/utils/pod-status'
import { RiDeleteBinLine, RiPlayLine, RiStopLine } from '@/lib/icons'

export interface PodItemProps {
  id: string
  name: string
  status: 'stopped' | 'running' | 'failed' | 'starting' | 'stopping'
  isSelected: boolean
  onSelect: () => void
  onStart: () => void
  onStop: () => void
  onDelete: () => void
}

export function PodItem({ name, status, isSelected, onSelect, onStart, onStop, onDelete }: PodItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md transition-colors group ${
        isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${POD_STATUS_COLORS[status]}`}
            title={POD_STATUS_LABELS[status]}
          />
          <span className="text-xs font-mono truncate">{name}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {(status === 'stopped' || status === 'failed') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStart()
              }}
              className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              title="Start"
            >
              <RiPlayLine className="h-3.5 w-3.5" />
            </button>
          )}
          {status === 'running' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
              className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 cursor-pointer"
              title="Stop"
            >
              <RiStopLine className="h-3.5 w-3.5" />
            </button>
          )}
          {status !== 'stopping' && status !== 'starting' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-0.5 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-red-400 cursor-pointer"
              title="Delete"
            >
              <RiDeleteBinLine className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
