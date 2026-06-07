import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { RiCheckboxCircleLine, RiSettings3Line } from '@/lib/icons'
import { orpcForPod, orpcUtils, unwrapPodId } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Checkbox } from '@/ui/checkbox'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/command'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group'

type DetectedFile = {
  path: string
  type: 'taskfile' | 'makefile' | 'package-json'
  relativePath: string
}

type DetectedCommand = {
  name: string
  command: string
  description?: string
  args: { name: string; required: boolean; default?: string }[]
  source: DetectedFile
}

interface ImportCommandsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  podId: string
  podCwd: string
  onImported: () => void
  initialSearch?: string
  /** When true, only relative paths are allowed (template editing). */
  isTemplate?: boolean
}

type DirMode = 'absolute' | 'relative'

const FILE_TYPE_LABELS: Record<string, string> = {
  taskfile: 'Taskfile',
  makefile: 'Makefile',
  'package-json': 'package.json',
}

export function ImportCommandsDialog({
  open,
  onOpenChange,
  podId,
  podCwd,
  onImported,
  initialSearch = '',
  isTemplate,
}: ImportCommandsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [directory, setDirectory] = useState('')
  const [dirMode, setDirMode] = useState<DirMode>(isTemplate ? 'relative' : 'absolute')
  const [tagInput, setTagInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // `discoverCommands` has to run on the machine that owns the pod —
  // it scans the pod's cwd for Taskfiles/Makefiles/package.json. On a
  // remote pod, routing through the paired client makes the scan
  // happen on the authoritative machine (the only one with those
  // files). Local orpcUtils would return nothing.
  const isRemotePod = podId.startsWith('remote:')
  const realPodId = unwrapPodId(podId)
  const remoteRegistryId = isRemotePod ? podId.split(':')[1] : null
  const { data: commands = [], isLoading } = useQuery(
    isRemotePod
      ? {
          queryKey: ['remote', remoteRegistryId!, 'pod.discoverCommands', realPodId] as const,
          queryFn: () => orpcForPod(podId).pod.discoverCommands({ podId: realPodId, maxDepth: 5 }),
          enabled: open,
        }
      : {
          ...orpcUtils.pod.discoverCommands.queryOptions({ input: { podId: realPodId, maxDepth: 5 } }),
          enabled: open,
        },
  )

  const grouped = useMemo(() => {
    const map = new Map<string, { file: DetectedFile; commands: DetectedCommand[] }>()
    for (const cmd of commands) {
      const key = cmd.source.path
      if (!map.has(key)) {
        map.set(key, { file: cmd.source, commands: [] })
      }
      map.get(key)!.commands.push(cmd)
    }
    return [...map.values()]
  }, [commands])

  // Unique key for each command (source path + name to avoid collisions across files)
  function cmdKey(cmd: DetectedCommand) {
    return `${cmd.source.path}::${cmd.name}`
  }

  function toggleCommand(cmd: DetectedCommand) {
    const key = cmdKey(cmd)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleGroup(cmds: DetectedCommand[]) {
    setSelected((prev) => {
      const next = new Set(prev)
      const keys = cmds.map(cmdKey)
      const allSelected = keys.every((k) => next.has(k))
      if (allSelected) {
        for (const k of keys) next.delete(k)
      } else {
        for (const k of keys) next.add(k)
      }
      return next
    })
  }

  async function handleImport() {
    const toImport = commands.filter((c) => selected.has(cmdKey(c)))
    if (toImport.length === 0) return

    setImporting(true)
    const tags = tagInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    try {
      const trimmedDir = directory.trim()
      const effectiveDir = dirMode === 'relative' ? trimmedDir || './' : trimmedDir || undefined
      await orpcForPod(podId).pod.importCommands({
        podId: unwrapPodId(podId),
        commands: toImport.map((c) => ({
          name: c.name,
          command: c.command,
          directory: effectiveDir,
          directoryMode: dirMode,
          args: c.args.length > 0 ? c.args : undefined,
          tagNames: tags.length > 0 ? tags : undefined,
        })),
      })
      onImported()
      onOpenChange(false)
      resetState()
    } finally {
      setImporting(false)
    }
  }

  function resetState() {
    setSelected(new Set())
    setDirectory('')
    setDirMode(isTemplate ? 'relative' : 'absolute')
    setTagInput('')
    setShowSettings(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Import Commands"
      description="Search and select commands to import"
    >
      <Command shouldFilter>
        <CommandInput placeholder="Search commands..." defaultValue={initialSearch} />
        <CommandList className="max-h-[320px]">
          {isLoading && <div className="px-3 py-6 text-center text-xs text-zinc-500">Scanning for commands...</div>}
          <CommandEmpty>No commands found</CommandEmpty>
          {grouped.map(({ file, commands: groupCmds }) => (
            <CommandGroup
              key={file.path}
              heading={
                <button
                  type="button"
                  onClick={() => toggleGroup(groupCmds)}
                  className="hover:text-zinc-300 transition-colors"
                >
                  {file.relativePath}
                  <span className="ml-1.5 text-zinc-600 font-normal">{FILE_TYPE_LABELS[file.type]}</span>
                </button>
              }
            >
              {groupCmds.map((cmd) => {
                const key = cmdKey(cmd)
                return (
                  <CommandItem
                    key={key}
                    value={`${cmd.name} ${cmd.command} ${cmd.description ?? ''} ${file.relativePath}`}
                    onSelect={() => toggleCommand(cmd)}
                    className="gap-2.5"
                  >
                    <Checkbox checked={selected.has(key)} className="pointer-events-none" tabIndex={-1} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-300 font-medium truncate">{cmd.name}</span>
                        {cmd.args.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            {cmd.args.map((arg) => (
                              <span
                                key={arg.name}
                                className={`text-[9px] px-1 py-0.5 rounded ${
                                  arg.required ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-700/50 text-zinc-500'
                                }`}
                                title={arg.default ? `Default: ${arg.default}` : arg.required ? 'Required' : 'Optional'}
                              >
                                {arg.name}
                                {arg.required ? '*' : '?'}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      {cmd.description && (
                        <p className="text-[10px] text-zinc-500 truncate mt-0.5">{cmd.description}</p>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-2 flex flex-col gap-2">
          {showSettings && (
            <div className="flex flex-col gap-2 px-1 pb-1">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <RiSettings3Line className="h-3 w-3" />
                  Directory
                </span>
                {!isTemplate && (
                  <ToggleGroup
                    value={[dirMode]}
                    onValueChange={(v) => {
                      if (v.length) {
                        const mode = v[0] as DirMode
                        setDirMode(mode)
                        if (mode === 'absolute' && (directory === './' || directory === '.')) {
                          setDirectory('')
                        } else if (mode === 'relative' && !directory) {
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
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <RiCheckboxCircleLine className="h-3 w-3" />
                  Tags (comma-separated)
                </span>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder="e.g. backend, db, dev"
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                />
              </label>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSettings((v) => !v)}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <RiSettings3Line className="h-3 w-3" />
                {showSettings ? 'Hide options' : 'Options'}
              </button>
              {selected.size > 0 && <span className="text-[10px] text-zinc-600">{selected.size} selected</span>}
            </div>
            <Button type="button" size="sm" disabled={selected.size === 0 || importing} onClick={handleImport}>
              {importing ? 'Importing...' : `Import ${selected.size}`}
            </Button>
          </div>
        </div>
      </Command>
    </CommandDialog>
  )
}
