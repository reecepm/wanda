import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCommandPalette } from '@/features/command-palette/store/command-palette-store'
import type { PodStatus } from '@/features/pod'
import { terminalRegistry } from '@/features/terminal/terminal-registry'
import type { RemixiconComponentType } from '@/lib/icons'
import { RiEraserLine, RiPlayLine, RiSearchLine, RiSettings3Line, RiTaskLine, RiTerminalBoxLine } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { useUIStore } from '@/stores/ui-store'

const STATUS_DOT: Record<string, string> = {
  running: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]',
  stopped: 'bg-zinc-600',
  failed: 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.4)]',
  starting: 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)] animate-pulse',
  stopping: 'bg-zinc-500 animate-pulse',
}

interface Command {
  id: string
  label: string
  icon: RemixiconComponentType
  category: string
  keywords?: string
  shortcut?: string
  status?: PodStatus
  onSelect: () => void
}

function matchQuery(query: string, label: string, keywords?: string): boolean {
  if (!query) return true
  const haystack = `${label} ${keywords ?? ''}`.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((w) => haystack.includes(w))
}

export function CommandPalette() {
  const { open, close } = useCommandPalette()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const activePodId = useUIStore((s) => s.activePodId)
  const recentPodIds = useUIStore((s) => s.recentPodIds)
  const selectedId = useUIStore((s) => s.selectedId)

  // Fetch projects + pods
  const { data: workspaces = [] } = useQuery(orpcUtils.workspace.list.queryOptions({}))

  const podQueries = useQueries({
    queries: workspaces.map((p) => orpcUtils.pod.list.queryOptions({ input: { workspaceId: p.id } })),
  })

  const allPods = useMemo(() => {
    const pods: { id: string; name: string; status: string; workspaceName: string }[] = []
    for (let i = 0; i < workspaces.length; i++) {
      const workspace = workspaces[i]
      const data = podQueries[i]?.data
      if (!workspace || !data) continue
      for (const pod of data) {
        pods.push({ id: pod.id, name: pod.name, status: pod.status, workspaceName: workspace.name })
      }
    }
    return pods
  }, [workspaces, podQueries])

  // Build commands
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = []

    // Pods — grouped by workspace, sorted by most-recently-used
    // Like Cmd+Tab: demote the currently focused pod so the second-most-recent is first
    const mruOrder = activePodId ? [...recentPodIds.filter((id) => id !== activePodId), activePodId] : recentPodIds
    const recencyIndex = new Map(mruOrder.map((id, i) => [id, i]))
    const podRecency = (id: string) => recencyIndex.get(id) ?? Number.MAX_SAFE_INTEGER

    // Sort workspaces by the best (lowest) recency of their pods
    const sortedWorkspaces = [...workspaces].sort((a, b) => {
      const aPods = allPods.filter((p) => p.workspaceName === a.name)
      const bPods = allPods.filter((p) => p.workspaceName === b.name)
      const aBest = Math.min(...aPods.map((p) => podRecency(p.id)), Number.MAX_SAFE_INTEGER)
      const bBest = Math.min(...bPods.map((p) => podRecency(p.id)), Number.MAX_SAFE_INTEGER)
      return aBest - bBest
    })

    for (const ws of sortedWorkspaces) {
      const wsPods = allPods
        .filter((p) => p.workspaceName === ws.name)
        .sort((a, b) => podRecency(a.id) - podRecency(b.id))
      for (const pod of wsPods) {
        cmds.push({
          id: `pod:open:${pod.id}`,
          label: pod.name,
          icon: RiTerminalBoxLine,
          category: ws.name,
          keywords: `${pod.workspaceName} pod terminal`,
          status: pod.status as PodStatus,
          onSelect: () => {
            useUIStore.getState().setActivePodId(pod.id)
            navigate({ to: '/pods/$podId', params: { podId: pod.id } })
          },
        })
        if (pod.status === 'stopped' || pod.status === 'failed') {
          cmds.push({
            id: `pod:start:${pod.id}`,
            label: `Start ${pod.name}`,
            icon: RiPlayLine,
            category: ws.name,
            keywords: `${pod.workspaceName} pod run`,
            onSelect: () => {
              orpcUtils.pod.start.call({ id: pod.id }).catch((err) => {
                console.error('[command-palette] pod.start failed:', { podId: pod.id, err })
              })
            },
          })
        }
      }
    }

    // Navigation
    cmds.push(
      {
        id: 'nav:tasks',
        label: 'Go to Tasks',
        icon: RiTaskLine,
        category: 'Navigation',
        keywords: 'task todo',
        onSelect: () => navigate({ to: '/tasks' }),
      },
      {
        id: 'nav:settings',
        label: 'Go to Settings',
        icon: RiSettings3Line,
        category: 'Navigation',
        keywords: 'preferences config',
        onSelect: () => navigate({ to: '/settings' }),
      },
    )

    // Terminal — only when the focused pane is a live xterm instance
    if (selectedId && terminalRegistry.has(selectedId)) {
      cmds.push({
        id: 'terminal:clear',
        label: 'Clear terminal',
        icon: RiEraserLine,
        category: 'Terminal',
        keywords: 'clear scrollback erase wipe',
        shortcut: '⌘K',
        onSelect: () => {
          void terminalRegistry.clear(selectedId)
        },
      })
    }

    return cmds
  }, [workspaces, allPods, navigate, recentPodIds, activePodId, selectedId])

  // Filter
  const filtered = useMemo(() => commands.filter((c) => matchQuery(query, c.label, c.keywords)), [commands, query])

  // Group by category
  const grouped = useMemo(() => {
    const groups: { category: string; items: Command[] }[] = []
    const categoryMap = new Map<string, Command[]>()
    for (const cmd of filtered) {
      let list = categoryMap.get(cmd.category)
      if (!list) {
        list = []
        categoryMap.set(cmd.category, list)
        groups.push({ category: cmd.category, items: list })
      }
      list.push(cmd)
    }
    return groups
  }, [filtered])

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // Focus after render
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, selectedIndex])

  // Scroll selected item into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex updates the data-selected DOM node queried below.
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.querySelector('[data-selected="true"]')
    if (item) item.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const execute = useCallback(
    (cmd: Command) => {
      close()
      cmd.onSelect()
    },
    [close],
  )

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
      close()
    }
  }

  if (!open) return null

  let flatIndex = 0

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled on input */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <div className="relative z-10 w-full max-w-[520px] bg-zinc-900 border border-zinc-700/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
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
            placeholder="Type a command..."
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
            // biome-ignore lint/a11y/noAutofocus: command palette should auto-focus
            autoFocus
          />
          <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-md">esc</kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="command-palette-results"
          role="listbox"
          className="max-h-[min(360px,50vh)] overflow-y-auto py-1"
        >
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-3 py-1.5">
                <span className="text-[10px] font-semibold text-zinc-500">{group.category}</span>
              </div>
              {group.items.map((cmd) => {
                const idx = flatIndex++
                const isSelected = idx === selectedIndex
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on input
                  <div
                    key={cmd.id}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    data-selected={isSelected}
                    onClick={() => execute(cmd)}
                    className={`flex items-center justify-between px-3 py-1.5 mx-1 rounded-md cursor-pointer text-sm transition-colors ${
                      isSelected
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <cmd.icon className="h-4 w-4 shrink-0 text-zinc-500" />
                      {cmd.label}
                      {cmd.status && (
                        <span className={`h-[6px] w-[6px] rounded-full shrink-0 ${STATUS_DOT[cmd.status]}`} />
                      )}
                    </span>
                    {cmd.shortcut && (
                      <kbd className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded-md ml-2 shrink-0">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-zinc-600">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  )
}
