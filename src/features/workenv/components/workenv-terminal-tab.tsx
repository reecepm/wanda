import { RiRefreshLine } from '@/lib/icons'
import { Button } from '@/ui/button'
import { useWorkenvTerminal } from '../hooks/use-workenv-terminal'

export function WorkenvTerminalTab({ workenvId, cmd, args }: { workenvId: string; cmd?: string; args?: string[] }) {
  const { containerRef, exitCode, error, restart } = useWorkenvTerminal({
    workenvId,
    cmd,
    args,
  })

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-2 py-1 border-b border-zinc-800 bg-zinc-900/40">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500">
          {cmd ?? '/bin/sh'} {args?.join(' ')}
        </div>
        <Button variant="ghost" size="sm" onClick={restart} title="Restart shell">
          <RiRefreshLine className="size-3.5" />
        </Button>
      </div>

      {error ? (
        <div className="p-3 text-xs text-red-400 font-mono break-all">{error}</div>
      ) : (
        <div className="flex-1 min-h-0 bg-zinc-950">
          <div ref={containerRef} className="w-full h-full" />
        </div>
      )}

      {exitCode != null && (
        <div className="px-2 py-1 text-[10px] text-zinc-500 border-t border-zinc-800">
          exit code: <span className="font-mono text-zinc-300">{exitCode}</span>
        </div>
      )}
    </div>
  )
}
