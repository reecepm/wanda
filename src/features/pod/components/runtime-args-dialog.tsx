import { useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'

interface CommandArg {
  name: string
  required: boolean
  default?: string
}

interface RuntimeArgsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  commandName: string
  baseCommand: string
  args: CommandArg[]
  onRun: (finalCommand: string) => void
}

export function RuntimeArgsDialog({
  open,
  onOpenChange,
  commandName,
  baseCommand,
  args,
  onRun,
}: RuntimeArgsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const arg of args) {
      initial[arg.name] = arg.default ?? ''
    }
    return initial
  })

  const allRequiredFilled = args.filter((a) => a.required).every((a) => values[a.name]?.trim())

  function buildCommand(): string {
    const parts = [baseCommand]
    for (const arg of args) {
      const val = values[arg.name]?.trim()
      if (val) {
        parts.push(`${arg.name}=${val}`)
      }
    }
    return parts.join(' ')
  }

  function handleRun() {
    onRun(buildCommand())
    onOpenChange(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const initial: Record<string, string> = {}
      for (const arg of args) {
        initial[arg.name] = arg.default ?? ''
      }
      setValues(initial)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run: {commandName}</DialogTitle>
          <DialogDescription className="font-mono text-[10px]">{baseCommand}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {args.map((arg) => (
            <label key={arg.name} className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">
                {arg.name}
                {arg.required && <span className="text-amber-400 ml-0.5">*</span>}
              </span>
              <input
                type="text"
                value={values[arg.name] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [arg.name]: e.target.value }))}
                placeholder={arg.default || (arg.required ? 'Required' : 'Optional')}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
              />
            </label>
          ))}

          {/* Preview */}
          <div className="rounded-md bg-zinc-900/50 border border-zinc-800 px-2.5 py-2">
            <p className="text-[10px] text-zinc-500 mb-1">Preview</p>
            <p className="text-xs font-mono text-zinc-300 break-all">{buildCommand()}</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={!allRequiredFilled} onClick={handleRun}>
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
