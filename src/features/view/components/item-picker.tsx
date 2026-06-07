import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { type AddItemActions, type AgentOption, buildSessionAgentOptions, CLI_AGENT_OPTIONS } from '@/features/pod'
import { type PendingPodAction, useItemPicker } from '@/features/view/hooks/use-item-picker'
import { useViewScope } from '@/features/view/scope/view-scope-context'
import {
  AGENT_MENU_CONFIG_SETTING_KEY,
  applyAgentMenuConfig,
  ITEM_MENU_ORDER_SETTING_KEY,
  orderItemMenuEntries,
  parseAgentMenuConfig,
  parseItemMenuOrder,
} from '@/features/view/utils/item-menu-order'
import {
  RiArchive2Line,
  RiArrowLeftLine,
  RiChatHistoryLine,
  RiFileTextLine,
  RiGlobalLine,
  RiPencilLine,
  RiRobot2Line,
  RiSearchLine,
  RiTerminalBoxLine,
  RiTerminalLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import type { AgentType } from '@/types/schema'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'

const AGENT_PICKER_ICON: Record<AgentOption['provider'], React.ReactNode> = {
  claude: <ClaudeIcon className="h-4 w-4" />,
  codex: <OpenAIIcon className="h-4 w-4" />,
  opencode: <OpenCodeIcon className="h-4 w-4" />,
  mock: <RiRobot2Line className="h-4 w-4" />,
}

interface ItemPickerProps {
  actions: AddItemActions
  actionsForPod?: (podId: string) => AddItemActions
}

interface PickerOption {
  id: string
  label: string
  description?: string
  statusDetail?: string
  icon: React.ReactNode
  keywords?: string
  onSelect: () => void
  disabled?: boolean
  /**
   * Optional right-side actions (rename / archive icons on session rows).
   * Rendered inside a span that stops click propagation so the row's main
   * onSelect fires only when the user clicks outside the actions.
   */
  rowActions?: React.ReactNode
}

export function ItemPicker({ actions, actionsForPod }: ItemPickerProps) {
  const { open, mode, closePicker, setMode, pendingPodAction, setPendingPodAction } = useItemPicker()
  const { config: scopeConfig, pods } = useViewScope()
  const requiresPodSelection = scopeConfig.itemCreation.requiresPodSelection
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Only fetch persisted sessions when the user drills into "Resume
  // session…". Keeps the picker snappy on open and avoids hitting the
  // server until the list is actually needed.
  const persistedSessions = useQuery({
    ...orpcUtils.agent.session.listPersisted.queryOptions({ input: {} }),
    enabled: open && mode === 'resume-session',
    staleTime: 5_000,
  })
  const providerManifests = useQuery({
    ...orpcUtils.agent.providers.list.queryOptions(),
    staleTime: 30_000,
  })
  const installedProviders = useQuery({
    ...orpcUtils.agent.providers.installed.queryOptions(),
    staleTime: 30_000,
  })
  const { data: savedOrder } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: ITEM_MENU_ORDER_SETTING_KEY } }),
  )
  const { data: savedAgentConfig } = useQuery(
    orpcUtils.settings.get.queryOptions({ input: { key: AGENT_MENU_CONFIG_SETTING_KEY } }),
  )

  // Rename / archive state. The rename dialog lives inside this component
  // (rather than a separate sibling) so ESC / click-outside can dismiss
  // just the dialog without closing the picker.
  const queryClient = useQueryClient()
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; title: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)

  const openRenameDialog = useCallback((sessionId: string, currentTitle: string | null) => {
    setRenameTarget({ sessionId, title: currentTitle ?? '' })
    setRenameValue(currentTitle ?? '')
  }, [])

  const invalidatePersisted = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: orpcUtils.agent.session.listPersisted.queryKey({ input: {} }),
    })
  }, [queryClient])

  const commitRename = useCallback(async () => {
    if (!renameTarget) return
    const clean = renameValue.trim().slice(0, 60)
    if (clean.length === 0) {
      toast.error('Title cannot be empty')
      return
    }
    if (clean === renameTarget.title) {
      setRenameTarget(null)
      return
    }
    setRenameBusy(true)
    try {
      await orpcUtils.agent.session.rename.call({ sessionId: renameTarget.sessionId, title: clean })
      invalidatePersisted()
      setRenameTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setRenameBusy(false)
    }
  }, [renameTarget, renameValue, invalidatePersisted])

  const archiveSession = useCallback(
    async (sessionId: string) => {
      try {
        await orpcUtils.agent.session.archive.call({ sessionId })
        invalidatePersisted()
        toast.success('Session archived', {
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                try {
                  await orpcUtils.agent.session.unarchive.call({ sessionId })
                  invalidatePersisted()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Undo failed')
                }
              })()
            },
          },
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Archive failed')
      }
    },
    [invalidatePersisted],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: mode changes should reset the picker query and focus.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, mode])

  const doAndClose = useCallback(
    (fn: () => void) => {
      closePicker()
      fn()
    },
    [closePicker],
  )

  const maybePodSelect = useCallback(
    (action: PendingPodAction, directFn: () => void) => {
      if (requiresPodSelection && pods && pods.length > 1) {
        setPendingPodAction(action)
      } else {
        doAndClose(directFn)
      }
    },
    [requiresPodSelection, pods, setPendingPodAction, doAndClose],
  )

  const handlePodSelected = useCallback(
    (podId: string) => {
      if (!pendingPodAction) return
      const selectedActions = actionsForPod?.(podId) ?? actions
      switch (pendingPodAction.type) {
        case 'terminal':
          doAndClose(() => selectedActions.addTerminal())
          break
        case 'browser':
          doAndClose(() => selectedActions.addBrowser())
          break
        case 'markdown':
          doAndClose(() => selectedActions.addMarkdown())
          break
        case 'agent':
          doAndClose(() => selectedActions.addAgent(pendingPodAction.agentType as AgentType))
          break
        case 'agent-session':
          doAndClose(() => selectedActions.addAgentSession(pendingPodAction.providerId))
          break
        case 'command':
          doAndClose(() => selectedActions.addCommand(pendingPodAction.commandId))
          break
        case 'new-command':
          doAndClose(() => selectedActions.newCommand())
          break
      }
    },
    [pendingPodAction, actions, actionsForPod, doAndClose],
  )

  const options = useMemo<PickerOption[]>(() => {
    if (mode === 'root') {
      return orderItemMenuEntries(
        [
          {
            id: 'agent',
            label: 'Agent',
            description: 'Start a new AI agent session',
            icon: <RiRobot2Line className="h-4 w-4" />,
            keywords: 'ai claude codex opencode',
            onSelect: () => setMode('agent'),
          },
          {
            id: 'terminal',
            label: 'Terminal',
            description: 'Open a new terminal',
            icon: <RiTerminalLine className="h-4 w-4" />,
            keywords: 'shell bash zsh',
            onSelect: () => maybePodSelect({ type: 'terminal' }, () => actions.addTerminal()),
          },
          {
            id: 'command',
            label: 'Command',
            description: 'Add a running command to view',
            icon: <RiTerminalBoxLine className="h-4 w-4" />,
            keywords: 'run script process',
            onSelect: () => setMode('command'),
          },
          {
            id: 'browser',
            label: 'Browser',
            description: 'Open a new browser tab',
            icon: <RiGlobalLine className="h-4 w-4" />,
            keywords: 'web url http',
            onSelect: () => maybePodSelect({ type: 'browser' }, () => actions.addBrowser()),
          },
          {
            id: 'markdown',
            label: 'Markdown File...',
            description: 'Open a markdown file editor',
            icon: <RiFileTextLine className="h-4 w-4" />,
            keywords: 'markdown md file notes docs',
            onSelect: () => maybePodSelect({ type: 'markdown' }, () => actions.addMarkdown()),
          },
        ],
        parseItemMenuOrder(savedOrder),
      )
    }

    if (mode === 'agent') {
      const sessionOptions = buildSessionAgentOptions({
        providers: providerManifests.data,
        installed: installedProviders.data,
      })
      const agentOptions = applyAgentMenuConfig(
        [...sessionOptions, ...CLI_AGENT_OPTIONS],
        parseAgentMenuConfig(savedAgentConfig),
      )
      const opts: PickerOption[] = agentOptions.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description ?? `${opt.label} ${opt.kind === 'cli' ? 'terminal CLI' : 'chat session'}`,
        statusDetail: opt.statusDetail,
        icon: (
          <span className="relative inline-flex h-4 w-4 items-center justify-center">
            {AGENT_PICKER_ICON[opt.provider] ?? <RiRobot2Line className="h-4 w-4" />}
            {opt.kind === 'cli' && (
              <RiTerminalLine
                className="absolute -right-1 -bottom-0.5 h-2.5 w-2.5 rounded-sm bg-background text-muted-foreground"
                aria-hidden
              />
            )}
          </span>
        ),
        keywords: `${opt.provider} ${opt.kind === 'cli' ? 'cli terminal tui' : 'chat session'}`,
        disabled: opt.disabled,
        onSelect: () => {
          if (opt.disabled) return
          if (opt.kind === 'session' && opt.sessionProviderId) {
            const providerId = opt.sessionProviderId
            maybePodSelect({ type: 'agent-session', providerId }, () => actions.addAgentSession(providerId))
          } else if (opt.kind === 'cli' && opt.cliAgentType) {
            maybePodSelect({ type: 'agent', agentType: opt.cliAgentType }, () =>
              actions.addAgent(opt.cliAgentType as AgentType),
            )
          }
        },
      }))
      opts.push({
        id: 'resume-session',
        label: 'Resume a previous session…',
        description: 'Re-attach an earlier agent session to this pod',
        icon: <RiChatHistoryLine className="h-4 w-4" />,
        keywords: 'history archived recent',
        onSelect: () => {
          setMode('resume-session')
          setQuery('')
          setSelectedIndex(0)
        },
      })
      return opts
    }

    if (mode === 'resume-session') {
      const rows = persistedSessions.data ?? []
      return rows.map((row) => {
        const label = row.title ?? '(untitled session)'
        const desc = [
          row.providerId,
          row.resident ? 'active' : row.state,
          row.lastEventAt ? formatTimeAgo(row.lastEventAt) : null,
        ]
          .filter(Boolean)
          .join(' · ')
        return {
          id: row.sessionId,
          label,
          description: desc,
          icon: <RiChatHistoryLine className="h-4 w-4" />,
          onSelect: () => doAndClose(() => actions.attachAgentSession(row.sessionId, row.title ?? undefined)),
          rowActions: (
            <>
              <button
                type="button"
                aria-label={`Rename ${label}`}
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation()
                  openRenameDialog(row.sessionId, row.title)
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
              >
                <RiPencilLine className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={`Archive ${label}`}
                title="Archive"
                onClick={(e) => {
                  e.stopPropagation()
                  void archiveSession(row.sessionId)
                }}
                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700"
              >
                <RiArchive2Line className="h-3.5 w-3.5" />
              </button>
            </>
          ),
        }
      })
    }

    if (mode === 'command') {
      const opts: PickerOption[] = actions.commandsNotInView.map((cmd) => ({
        id: cmd.id,
        label: cmd.name,
        description: cmd.name,
        icon: <RiTerminalBoxLine className="h-4 w-4" />,
        onSelect: () => maybePodSelect({ type: 'command', commandId: cmd.id }, () => actions.addCommand(cmd.id)),
      }))

      opts.push({
        id: 'new-command',
        label: 'New Command...',
        description: 'Create a new command',
        icon: <RiTerminalBoxLine className="h-4 w-4" />,
        onSelect: () => maybePodSelect({ type: 'new-command' }, () => actions.newCommand()),
      })

      return opts
    }

    if (mode === 'select-pod') {
      return (pods ?? []).map((pod) => ({
        id: pod.id,
        label: pod.name,
        description: `Create in ${pod.name}`,
        icon: <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: pod.color }} />,
        onSelect: () => handlePodSelected(pod.id),
      }))
    }

    return []
  }, [
    mode,
    actions,
    doAndClose,
    setMode,
    maybePodSelect,
    pods,
    handlePodSelected,
    persistedSessions.data,
    providerManifests.data,
    installedProviders.data,
    savedOrder,
    savedAgentConfig,
    openRenameDialog,
    archiveSession,
  ])

  const filtered = useMemo(() => {
    if (!query) return options
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return options.filter((opt) => {
      const haystack = `${opt.label} ${opt.description ?? ''} ${opt.keywords ?? ''}`.toLowerCase()
      return words.every((w) => haystack.includes(w))
    })
  }, [options, query])

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, selectedIndex])

  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex drives the active row scroll target.
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.querySelector('[data-selected="true"]')
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const execute = useCallback((opt: PickerOption) => {
    if (opt.disabled) return
    opt.onSelect()
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => (i + 1) % Math.max(1, filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) execute(filtered[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (mode !== 'root') {
        setMode('root')
        setQuery('')
        setSelectedIndex(0)
      } else {
        closePicker()
      }
    } else if (e.key === 'Backspace' && !query && mode !== 'root') {
      setMode('root')
      setSelectedIndex(0)
    }
  }

  if (!open) return null

  const showBack = mode !== 'root'
  const title =
    mode === 'root'
      ? 'Add to view'
      : mode === 'agent'
        ? 'Select Agent'
        : mode === 'resume-session'
          ? 'Resume Session'
          : mode === 'command'
            ? 'Select Command'
            : mode === 'select-pod'
              ? 'Select Pod'
              : 'Add to view'

  return (
    <div
      role="dialog"
      aria-label="Item picker"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled on input */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div className="absolute inset-0 bg-black/50" onClick={closePicker} />

      <div className="relative z-10 w-full max-w-[520px] bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
          {showBack && (
            <button
              type="button"
              onClick={() => {
                setMode('root')
                setQuery('')
                setSelectedIndex(0)
              }}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <RiArrowLeftLine className="h-3.5 w-3.5" />
            </button>
          )}
          <RiSearchLine className="h-4 w-4 text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={title}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
            // biome-ignore lint/a11y/noAutofocus: picker should auto-focus
            autoFocus
          />
          <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-md">esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} role="listbox" className="max-h-[min(360px,50vh)] overflow-y-auto py-1">
          {filtered.map((opt, idx) => {
            const isSelected = idx === selectedIndex
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on input
              <div
                key={opt.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={-1}
                data-selected={isSelected}
                onClick={() => execute(opt)}
                className={`flex items-center gap-3 px-3 py-2 mx-1 rounded-md transition-colors ${
                  opt.disabled
                    ? 'cursor-not-allowed text-zinc-600'
                    : isSelected
                      ? 'cursor-pointer bg-zinc-800 text-zinc-100'
                      : 'cursor-pointer text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
              >
                <span className="shrink-0 text-zinc-500">{opt.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{opt.label}</p>
                  {opt.description && <p className="text-[10px] text-zinc-600 truncate">{opt.description}</p>}
                  {opt.statusDetail && <p className="text-[10px] text-zinc-500 truncate">{opt.statusDetail}</p>}
                </div>
                {opt.rowActions && <span className="flex items-center gap-0.5">{opt.rowActions}</span>}
                {((mode === 'root' && (opt.id === 'agent' || opt.id === 'command')) ||
                  (mode === 'agent' && opt.id === 'resume-session')) && (
                  <span className="text-[10px] text-zinc-600">→</span>
                )}
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">
              {mode === 'resume-session'
                ? persistedSessions.isLoading
                  ? 'Loading sessions…'
                  : persistedSessions.isError
                    ? 'Failed to load sessions'
                    : 'No previous sessions'
                : 'No matching items'}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={renameTarget != null}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Rename the session to make it easier to find later. Clears when you archive the session.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            maxLength={60}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitRename()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setRenameTarget(null)
              }
            }}
            placeholder="Session title"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={renameBusy}>
              Cancel
            </Button>
            <Button onClick={() => void commitRename()} disabled={renameBusy}>
              {renameBusy ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 0 || diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
