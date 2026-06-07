import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'
import { WorkenvTerminalTab } from './workenv-terminal-tab'

/**
 * Modal for running a one-shot command against a workenv. Spawns a new
 * exec session via the terminal pipeline; destroying it on close tears
 * the session down through `useWorkenvTerminal`'s cleanup path.
 */
export function WorkenvExecDialog({
  workenvId,
  open,
  onOpenChange,
  initialCmd,
  initialArgs,
  title,
}: {
  workenvId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-filled command. User can still edit before spawning. */
  initialCmd?: string
  /** Pre-filled args. */
  initialArgs?: readonly string[]
  /** Override the default "Run command" title (e.g. "Healthcheck"). */
  title?: string
}) {
  const [cmd, setCmd] = useState(initialCmd ?? '')
  const [argsRaw, setArgsRaw] = useState((initialArgs ?? []).join(' '))
  const [spawned, setSpawned] = useState<{ cmd: string; args: string[] } | null>(null)

  function handleRun() {
    const trimmed = cmd.trim()
    if (!trimmed) return
    const args = argsRaw
      .trim()
      .split(/\s+/)
      .filter((s) => s.length > 0)
    setSpawned({ cmd: trimmed, args })
  }

  function handleClose(next: boolean) {
    // Tearing down the terminal is handled by unmounting the inner tab,
    // which triggers the hook's cleanup. Just reset local form state so
    // re-opening starts cleanly.
    if (!next) setSpawned(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? 'Run command in environment'}</DialogTitle>
          <DialogDescription>
            Spawns a one-shot exec session via the environment's runtime adapter. Output streams live; close this dialog
            to terminate.
          </DialogDescription>
        </DialogHeader>

        {spawned ? (
          <div className="h-[320px] rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden">
            <WorkenvTerminalTab workenvId={workenvId} cmd={spawned.cmd} args={spawned.args} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Command">
              <Input
                autoFocus
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="/bin/sh"
                className="font-mono"
              />
            </Field>
            <Field label="Args" hint="Space-separated. Quoting is not parsed.">
              <Input
                value={argsRaw}
                onChange={(e) => setArgsRaw(e.target.value)}
                placeholder='-c "echo hello"'
                className="font-mono"
              />
            </Field>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>
            {spawned ? 'Close' : 'Cancel'}
          </Button>
          {!spawned && (
            <Button onClick={handleRun} disabled={!cmd.trim()}>
              Run
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
    </label>
  )
}
