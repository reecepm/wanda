import { useViewScope } from '@/features/view/scope/view-scope-context'
import { RiDeleteBinLine, RiPlayFill, RiTerminalBoxLine } from '@/lib/icons'
import { orpcForPod } from '@/shared/orpc'

interface CommandStoppedViewProps {
  podCommandId: string
  name: string
  command?: string
  onChanged?: () => void
}

export function CommandStoppedView({ podCommandId, name, command, onChanged }: CommandStoppedViewProps) {
  // Closing over the pod id from scope context guarantees that any later
  // pod navigation doesn't cause our callbacks to route to a different
  // pod's server mid-click.
  const { entityId: podId } = useViewScope()

  async function handleStart() {
    await orpcForPod(podId).pod.startCommand({ podCommandId })
    onChanged?.()
  }

  async function handleDelete() {
    await orpcForPod(podId).pod.removeCommand({ id: podCommandId })
    onChanged?.()
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-4">
      <RiTerminalBoxLine className="h-8 w-8 text-zinc-700 mb-3" />
      <p className="text-sm text-zinc-400 mb-1">{name}</p>
      {command && <p className="text-xs text-zinc-600 font-mono mb-3">{command}</p>}
      <p className="text-xs text-zinc-600 mb-3">Command is not running</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleStart}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
        >
          <RiPlayFill className="h-3 w-3" />
          Start
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-red-400 bg-zinc-800 hover:bg-zinc-800/80 rounded-md transition-colors"
        >
          <RiDeleteBinLine className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  )
}
