import { useMemo, useState } from 'react'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

export interface CommandDialogData {
  name: string
  command: string
  directory?: string
  directoryMode?: 'absolute' | 'relative'
  autoStart: boolean
}

type DirMode = 'absolute' | 'relative'

interface AddCommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CommandDialogData) => void
  podCwd: string
  /** When true, only relative paths are shown (template editing) */
  isTemplate?: boolean
  /** When provided, dialog is in edit mode pre-filled with these values */
  editValues?: CommandDialogData | null
}

export function AddCommandDialog({
  open,
  onOpenChange,
  onSubmit,
  podCwd,
  isTemplate,
  editValues,
}: AddCommandDialogProps) {
  const isEdit = !!editValues
  const dialogKey = editValues
    ? `edit:${editValues.name}:${editValues.command}:${editValues.directory ?? ''}:${editValues.directoryMode ?? ''}:${editValues.autoStart}`
    : `add:${podCwd}:${isTemplate ? 'template' : 'pod'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <AddCommandDialogContent
          key={dialogKey}
          isEdit={isEdit}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          podCwd={podCwd}
          isTemplate={isTemplate}
          editValues={editValues}
        />
      )}
    </Dialog>
  )
}

type AddCommandDialogContentProps = Omit<AddCommandDialogProps, 'open'> & { isEdit: boolean }

function AddCommandDialogContent({
  isEdit,
  onOpenChange,
  onSubmit,
  podCwd,
  isTemplate,
  editValues,
}: AddCommandDialogContentProps) {
  const initialValues = useMemo(() => {
    if (!editValues) {
      return {
        name: '',
        command: '',
        directory: isTemplate ? './' : podCwd,
        dirMode: (isTemplate ? 'relative' : 'absolute') as DirMode,
        autoStart: false,
      }
    }

    const dir = editValues.directory || podCwd
    const stored = editValues.directoryMode
    const isRel = dir && !dir.startsWith('/')
    return {
      name: editValues.name,
      command: editValues.command,
      directory: dir,
      dirMode: (isTemplate ? 'relative' : (stored ?? (isRel ? 'relative' : 'absolute'))) as DirMode,
      autoStart: editValues.autoStart,
    }
  }, [editValues, isTemplate, podCwd])

  const [name, setName] = useState(initialValues.name)
  const [command, setCommand] = useState(initialValues.command)
  const [directory, setDirectory] = useState(initialValues.directory)
  const [dirMode, setDirMode] = useState<DirMode>(initialValues.dirMode)
  const [autoStart, setAutoStart] = useState(initialValues.autoStart)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !command.trim()) return
    const dir = directory.trim()
    onSubmit({
      name: name.trim(),
      command: command.trim(),
      directory: dirMode === 'relative' ? dir || './' : dir && dir !== podCwd ? dir : undefined,
      directoryMode: dirMode,
      autoStart,
    })
    if (!isEdit) {
      setName('')
      setCommand('')
      setDirMode(isTemplate ? 'relative' : 'absolute')
      setDirectory(isTemplate ? './' : podCwd)
      setAutoStart(false)
    }
    onOpenChange(false)
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit Command' : 'Add Command'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update this command.'
            : isTemplate
              ? 'Define a command for this template.'
              : 'Define a terminal command to run in this pod.'}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dev Server"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
            // biome-ignore lint/a11y/noAutofocus: dialog should auto-focus first input
            autoFocus
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Command</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="e.g. npm run dev"
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Directory</span>
          {!isTemplate && (
            <ToggleGroup
              value={[dirMode]}
              onValueChange={(v) => {
                if (v.length) {
                  const mode = v[0] as DirMode
                  setDirMode(mode)
                  if (mode === 'absolute' && (directory === './' || directory === '.')) {
                    setDirectory(podCwd)
                  } else if (mode === 'relative' && directory === podCwd) {
                    setDirectory('./')
                  }
                }
              }}
              variant="outline"
              size="sm"
              className="mb-1"
            >
              <ToggleGroupItem value="absolute">Absolute</ToggleGroupItem>
              <ToggleGroupItem value="relative">Relative</ToggleGroupItem>
            </ToggleGroup>
          )}
          <input
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder={dirMode === 'relative' ? './packages/api' : podCwd}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
          />
          {dirMode === 'relative' && (
            <p className="text-[10px] text-zinc-600">Relative to the pod's working directory</p>
          )}
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => setAutoStart(e.target.checked)}
            className="rounded border-zinc-700"
          />
          <span className="text-xs text-zinc-400">Start automatically when pod starts</span>
        </label>

        <DialogFooter>
          <Button type="submit" size="sm" disabled={!name.trim() || !command.trim()}>
            {isEdit ? 'Save Changes' : 'Add Command'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
