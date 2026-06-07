import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { CommandConfig, RunningCommand } from '@/features/view'
import {
  RiAddLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiLayoutGridLine,
  RiPencilLine,
  RiPlayFill,
  RiPriceTag3Line,
  RiRestartLine,
  RiSearchLine,
  RiStopFill,
  RiTerminalBoxLine,
} from '@/lib/icons'
import { orpcForPod, orpcUtils, unwrapPodId } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { AddCommandDialog, type CommandDialogData } from './add-command-dialog'
import { CommandOutputDialog } from './command-output-dialog'
import { ImportCommandsDialog } from './import-commands-dialog'
import { RuntimeArgsDialog } from './runtime-args-dialog'

interface CommandsPopoverProps {
  podId: string
  podCwd: string
  commandConfigs: CommandConfig[]
  runningCommands: RunningCommand[]
  onChanged: () => void
  onAddToView?: (podCommandId: string) => void
  isTemplate?: boolean
}

export function CommandsPopover({
  podId,
  podCwd,
  commandConfigs,
  runningCommands,
  onChanged,
  onAddToView,
  isTemplate,
}: CommandsPopoverProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editCmd, setEditCmd] = useState<{ id: string; values: CommandDialogData } | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [outputCmd, setOutputCmd] = useState<CommandConfig | null>(null)
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [argsCmd, setArgsCmd] = useState<CommandConfig | null>(null)
  const [tagPopoverCmd, setTagPopoverCmd] = useState<string | null>(null)
  const [newTagInput, setNewTagInput] = useState('')
  const [fallbackSearch, setFallbackSearch] = useState('')

  // Route the tag listing through the pod's owning server. For a remote
  // pod, using `orpcUtils.pod.listTags.queryOptions` would hit the LOCAL
  // server with a namespaced id it doesn't know about, returning empty
  // tags. We also use a `['remote', registryId, ...]` key so the paired
  // invalidation predicate in `usePairedInvalidation` can refresh it.
  const isRemotePod = podId.startsWith('remote:')
  const realPodId = unwrapPodId(podId)
  const remoteRegistryId = isRemotePod ? podId.split(':')[1] : null
  const { data: tags = [] } = useQuery(
    isRemotePod
      ? {
          queryKey: ['remote', remoteRegistryId!, 'pod.listTags', realPodId] as const,
          queryFn: () => orpcForPod(podId).pod.listTags({ podId: realPodId }),
        }
      : { ...orpcUtils.pod.listTags.queryOptions({ input: { podId: realPodId } }) },
  )

  const runningCount = runningCommands.length

  // Collect all unique tags from commands
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const cmd of commandConfigs) {
      for (const tag of cmd.tags ?? []) tagSet.add(tag)
    }
    return Array.from(tagSet).sort()
  }, [commandConfigs])

  const filteredCommands = useMemo(() => {
    return commandConfigs.filter((cmd) => {
      // Tag filter (OR)
      if (selectedTags.size > 0) {
        const cmdTags = cmd.tags ?? []
        if (!cmdTags.some((t) => selectedTags.has(t))) return false
      }
      // Text search
      if (search) {
        const q = search.toLowerCase()
        if (!cmd.name.toLowerCase().includes(q) && !cmd.command.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [commandConfigs, selectedTags, search])

  function getRunning(cmdId: string) {
    return runningCommands.find((r) => r.podCommandId === cmdId)
  }

  async function handleAdd(data: CommandDialogData) {
    await orpcForPod(podId).pod.addCommand({ podId: unwrapPodId(podId), ...data })
    onChanged()
  }

  async function handleEdit(data: CommandDialogData) {
    if (!editCmd) return
    await orpcForPod(podId).pod.updateCommand({
      id: editCmd.id,
      name: data.name,
      command: data.command,
      directory: data.directory ?? null,
      directoryMode: data.directoryMode,
      autoStart: data.autoStart,
    })
    setEditCmd(null)
    onChanged()
  }

  function handleStartOrPromptArgs(cmd: CommandConfig) {
    if (cmd.args && cmd.args.length > 0) {
      setArgsCmd(cmd)
    } else {
      handleStart(cmd.id)
    }
  }

  async function handleStart(cmdId: string) {
    await orpcForPod(podId).pod.startCommand({ podCommandId: cmdId })
    onChanged()
  }

  async function handleStop(cmdId: string) {
    await orpcForPod(podId).pod.stopCommand({ podCommandId: cmdId })
    onChanged()
  }

  async function handleRestart(cmdId: string) {
    await orpcForPod(podId).pod.restartCommand({ podCommandId: cmdId })
    onChanged()
  }

  async function handleDelete(cmdId: string) {
    await orpcForPod(podId).pod.removeCommand({ id: cmdId })
    onChanged()
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  async function handleTagCommand(commandId: string, tagName: string) {
    const client = orpcForPod(podId)
    const tag = await client.pod.createTag({ podId: unwrapPodId(podId), name: tagName })
    await client.pod.tagCommand({ commandId, tagId: tag.id })
    onChanged()
  }

  async function handleUntagCommand(commandId: string, tagName: string) {
    const tag = tags.find((t) => t.name === tagName)
    if (tag) {
      await orpcForPod(podId).pod.untagCommand({ commandId, tagId: tag.id })
      onChanged()
    }
  }

  function handleFallbackSearch() {
    setFallbackSearch(search)
    setImportDialogOpen(true)
  }

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button variant="outline" size="icon-xs" title="Commands" aria-label="Commands" className="relative" />
          }
        >
          <RiTerminalBoxLine />
          {runningCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 flex items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white">
              {runningCount}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
            <span className="text-xs font-medium text-zinc-300">Commands</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSearchVisible(!searchVisible)}
                className={`p-1 rounded transition-colors ${searchVisible ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
                title="Search"
              >
                <RiSearchLine className="h-3 w-3" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddMenuOpen(!addMenuOpen)}
                  className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <RiAddLine className="h-3 w-3" />
                  Add
                </button>
                {addMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false)
                        setAddDialogOpen(true)
                      }}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      Add manually
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false)
                        setImportDialogOpen(true)
                      }}
                      className="w-full px-3 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
                    >
                      <RiDownloadLine className="h-3 w-3" />
                      Import from file
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Search input */}
          {searchVisible && (
            <div className="px-3 py-2 border-b border-zinc-800">
              <div className="relative">
                <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter commands..."
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 pl-7 pr-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                  // biome-ignore lint/a11y/noAutofocus: search field
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Tag filter chips */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800 overflow-x-auto">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                    selectedTags.has(tag)
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Command list */}
          <div className="max-h-[300px] overflow-y-auto">
            {filteredCommands.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-zinc-600 mb-2">
                  {commandConfigs.length === 0 ? 'No commands configured' : 'No matching commands'}
                </p>
                {(search || selectedTags.size > 0) && commandConfigs.length > 0 && (
                  <button
                    type="button"
                    onClick={handleFallbackSearch}
                    className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Search in project files
                  </button>
                )}
              </div>
            ) : (
              filteredCommands.map((cmd) => {
                const running = getRunning(cmd.id)
                return (
                  <div key={cmd.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 group">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${running ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
                    <button type="button" onClick={() => setOutputCmd(cmd)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs text-zinc-300 truncate">{cmd.name}</p>
                        {cmd.args && cmd.args.length > 0 && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 shrink-0">
                            {cmd.args.length} arg{cmd.args.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-600 font-mono truncate">{cmd.command}</p>
                      {cmd.tags && cmd.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {cmd.tags.map((tag) => (
                            <span key={tag} className="text-[9px] px-1 py-0 rounded bg-zinc-800 text-zinc-500">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {running ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRestart(cmd.id)}
                            className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-amber-400"
                            title="Restart"
                          >
                            <RiRestartLine className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStop(cmd.id)}
                            className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
                            title="Stop"
                          >
                            <RiStopFill className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleStartOrPromptArgs(cmd)}
                          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-emerald-400"
                          title="Start"
                        >
                          <RiPlayFill className="h-3 w-3" />
                        </button>
                      )}
                      {/* Edit button */}
                      <button
                        type="button"
                        onClick={() =>
                          setEditCmd({
                            id: cmd.id,
                            values: {
                              name: cmd.name,
                              command: cmd.command,
                              directory: cmd.directory ?? undefined,
                              directoryMode: cmd.directoryMode,
                              autoStart: cmd.autoStart ?? false,
                            },
                          })
                        }
                        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                        title="Edit"
                      >
                        <RiPencilLine className="h-3 w-3" />
                      </button>
                      {/* Tag button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setTagPopoverCmd(tagPopoverCmd === cmd.id ? null : cmd.id)}
                          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Tags"
                        >
                          <RiPriceTag3Line className="h-3 w-3" />
                        </button>
                        {tagPopoverCmd === cmd.id && (
                          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg">
                            {/* Existing tags to toggle */}
                            {allTags.map((tag) => {
                              const hasTag = cmd.tags?.includes(tag)
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() =>
                                    hasTag ? handleUntagCommand(cmd.id, tag) : handleTagCommand(cmd.id, tag)
                                  }
                                  className={`w-full px-3 py-1 text-left text-[11px] transition-colors ${
                                    hasTag ? 'text-blue-400 bg-blue-500/10' : 'text-zinc-400 hover:bg-zinc-800'
                                  }`}
                                >
                                  {hasTag ? '- ' : '+ '}
                                  {tag}
                                </button>
                              )
                            })}
                            {/* New tag input */}
                            <div className="px-2 pt-1 border-t border-zinc-800 mt-1">
                              <input
                                type="text"
                                value={newTagInput}
                                onChange={(e) => setNewTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && newTagInput.trim()) {
                                    handleTagCommand(cmd.id, newTagInput.trim())
                                    setNewTagInput('')
                                    setTagPopoverCmd(null)
                                  }
                                }}
                                placeholder="New tag..."
                                className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
                                // biome-ignore lint/a11y/noAutofocus: tag input
                                autoFocus
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {onAddToView && (
                        <button
                          type="button"
                          onClick={() => onAddToView(cmd.id)}
                          className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300"
                          title="Add to view"
                        >
                          <RiLayoutGridLine className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(cmd.id)}
                        className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
                        title="Delete"
                      >
                        <RiDeleteBinLine className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>

      <AddCommandDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onSubmit={handleAdd}
        podCwd={podCwd}
        isTemplate={isTemplate}
      />

      <AddCommandDialog
        open={!!editCmd}
        onOpenChange={(open) => !open && setEditCmd(null)}
        onSubmit={handleEdit}
        podCwd={podCwd}
        isTemplate={isTemplate}
        editValues={editCmd?.values}
      />

      <ImportCommandsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        podId={podId}
        podCwd={podCwd}
        onImported={onChanged}
        initialSearch={fallbackSearch}
        isTemplate={isTemplate}
      />

      {outputCmd && (
        <CommandOutputDialog
          open={!!outputCmd}
          onOpenChange={(open) => !open && setOutputCmd(null)}
          name={outputCmd.name}
          command={outputCmd.command}
          ptyInstanceId={getRunning(outputCmd.id)?.ptyInstanceId ?? null}
          onStart={() => handleStartOrPromptArgs(outputCmd)}
          onStop={() => handleStop(outputCmd.id)}
          onRestart={() => handleRestart(outputCmd.id)}
        />
      )}

      {argsCmd?.args && (
        <RuntimeArgsDialog
          open={!!argsCmd}
          onOpenChange={(open) => !open && setArgsCmd(null)}
          commandName={argsCmd.name}
          baseCommand={argsCmd.command}
          args={argsCmd.args}
          onRun={(_finalCommand) => {
            // Starts the base command; per-run arg substitution is not applied.
            handleStart(argsCmd.id)
            setArgsCmd(null)
          }}
        />
      )}
    </>
  )
}
