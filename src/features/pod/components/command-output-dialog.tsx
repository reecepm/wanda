import { TerminalView } from '@/features/terminal/components/terminal-view'
import { RiPlayFill, RiRestartLine, RiStopFill } from '@/lib/icons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/dialog'

interface CommandOutputDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  command: string
  ptyInstanceId: string | null
  onStart: () => void
  onStop: () => void
  onRestart: () => void
}

export function CommandOutputDialog({
  open,
  onOpenChange,
  name,
  command,
  ptyInstanceId,
  onStart,
  onStop,
  onRestart,
}: CommandOutputDialogProps) {
  const isRunning = !!ptyInstanceId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[70vh]" showCloseButton>
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <span className={`h-2 w-2 rounded-full shrink-0 ${isRunning ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
            <DialogTitle>{name}</DialogTitle>
            <div className="flex items-center gap-1 ml-auto">
              {isRunning ? (
                <>
                  <button
                    type="button"
                    onClick={onRestart}
                    className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-amber-400 transition-colors"
                    title="Restart"
                  >
                    <RiRestartLine className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onStop}
                    className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-colors"
                    title="Stop"
                  >
                    <RiStopFill className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onStart}
                  className="p-1 rounded-md hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400 transition-colors"
                  title="Start"
                >
                  <RiPlayFill className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <p className="text-xs text-zinc-600 font-mono">{command}</p>
        </DialogHeader>
        <div className="flex-1 min-h-0 rounded-md overflow-hidden border border-zinc-800">
          {ptyInstanceId ? (
            <TerminalView terminalId={ptyInstanceId} className="h-full" />
          ) : (
            <div className="h-full flex items-center justify-center text-zinc-600 text-xs">Command is not running</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
