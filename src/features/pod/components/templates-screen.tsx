import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type KeyboardEvent, useCallback, useMemo, useState } from 'react'
import { SectionHeader } from '@/layout/section-header'
import {
  RiAddLine,
  RiCommandLine,
  RiDeleteBinLine,
  RiEditLine,
  RiGlobalLine,
  RiLayoutGridLine,
  RiTerminalBoxLine,
} from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { cn } from '@/shared/utils'
import { Badge } from '@/ui/badge'
import { Button } from '@/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog'
import { Input } from '@/ui/input'

type ScopeFilter = 'all' | 'global' | string

export function TemplatesScreen() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Edit dialog state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createScope, setCreateScope] = useState<string>('global')

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')

  const { data: templates = [] } = useQuery(orpcUtils.template.list.queryOptions({}))
  const { data: workspaces = [] } = useQuery(orpcUtils.workspace.list.queryOptions({}))

  const templateIds = useMemo(() => templates.map((t) => t.id), [templates])
  const terminalQueries = useQuery({
    queryKey: ['template-terminals', templateIds],
    queryFn: async () => {
      const counts: Record<string, number> = {}
      await Promise.all(
        templateIds.map(async (id) => {
          const terminals = await orpcUtils.pod.listTerminals.call({ podId: id })
          counts[id] = terminals.length
        }),
      )
      return counts
    },
    enabled: templateIds.length > 0,
  })
  const commandQueries = useQuery({
    queryKey: ['template-commands', templateIds],
    queryFn: async () => {
      const counts: Record<string, number> = {}
      await Promise.all(
        templateIds.map(async (id) => {
          const commands = await orpcUtils.pod.listCommands.call({ podId: id })
          counts[id] = commands.length
        }),
      )
      return counts
    },
    enabled: templateIds.length > 0,
  })
  const terminalCounts = terminalQueries.data ?? {}
  const commandCounts = commandQueries.data ?? {}

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpcUtils.template.list.key() })
    queryClient.invalidateQueries({ queryKey: ['template-terminals'] })
    queryClient.invalidateQueries({ queryKey: ['template-commands'] })
  }, [queryClient])

  const workspaceScopes = useMemo(() => {
    const ids = new Set(templates.filter((t) => t.workspaceId).map((t) => t.workspaceId!))
    return workspaces.filter((w) => ids.has(w.id))
  }, [templates, workspaces])

  const filtered = useMemo(() => {
    if (scopeFilter === 'all') return templates
    if (scopeFilter === 'global') return templates.filter((t) => !t.workspaceId)
    return templates.filter((t) => t.workspaceId === scopeFilter)
  }, [templates, scopeFilter])

  function workspaceName(id: string | null) {
    if (!id) return null
    return workspaces.find((w) => w.id === id)?.name ?? null
  }

  function navigateToTemplate(templateId: string) {
    navigate({ to: '/templates/$templateId', params: { templateId } })
  }

  function handleTemplateCardKeyDown(e: KeyboardEvent<HTMLDivElement>, templateId: string) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    navigateToTemplate(templateId)
  }

  async function handleDelete(id: string) {
    await orpcUtils.template.delete.call({ id })
    invalidate()
  }

  function startEdit(t: (typeof templates)[number]) {
    setEditingId(t.id)
    setEditName(t.name)
    setEditDesc(t.templateDescription ?? '')
  }

  async function handleEditSave() {
    if (!editingId) return
    await orpcUtils.template.update.call({
      id: editingId,
      name: editName,
      templateDescription: editDesc || undefined,
    })
    setEditingId(null)
    invalidate()
  }

  function openCreate() {
    setCreateName('')
    setCreateDesc('')
    setCreateScope('global')
    setShowCreate(true)
  }

  async function handleCreate() {
    if (!createName.trim()) return
    const wsId = createScope === 'global' ? null : createScope
    const created = await orpcUtils.template.create.call({
      name: createName.trim(),
      description: createDesc.trim() || undefined,
      workspaceId: wsId,
    })
    setShowCreate(false)
    invalidate()
    if (created) {
      navigate({ to: '/templates/$templateId', params: { templateId: created.id } })
    }
  }

  const hasMultipleScopes = workspaceScopes.length > 0 || templates.some((t) => !t.workspaceId)

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-6">
        <SectionHeader
          title="Templates"
          description="Save a pod's terminals, commands, and config so you can spin the same setup back up later."
          action={
            <Button size="sm" onClick={openCreate}>
              <RiAddLine className="size-3.5" />
              New template
            </Button>
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-500 text-sm">
            <RiLayoutGridLine className="size-8 text-zinc-600" />
            <p>No templates yet</p>
            <p className="text-xs text-zinc-600">
              Create one from scratch or right-click a pod and select "Save as Template"
            </p>
            <Button variant="outline" size="sm" onClick={openCreate} className="mt-2 gap-1.5 text-xs">
              <RiAddLine className="size-3.5" />
              New Template
            </Button>
          </div>
        ) : (
          <>
            {hasMultipleScopes && (
              <div className="flex items-center gap-1 px-6 pt-4 pb-2">
                <button
                  type="button"
                  onClick={() => setScopeFilter('all')}
                  className={cn(
                    'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                    scopeFilter === 'all'
                      ? 'bg-zinc-700 text-zinc-200'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
                  )}
                >
                  All
                </button>
                {templates.some((t) => !t.workspaceId) && (
                  <button
                    type="button"
                    onClick={() => setScopeFilter('global')}
                    className={cn(
                      'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                      scopeFilter === 'global'
                        ? 'bg-zinc-700 text-zinc-200'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
                    )}
                  >
                    Global
                  </button>
                )}
                {workspaceScopes.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    onClick={() => setScopeFilter(ws.id)}
                    className={cn(
                      'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                      scopeFilter === ws.id
                        ? 'bg-zinc-700 text-zinc-200'
                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800',
                    )}
                  >
                    {ws.name}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 px-6 py-3">
              {filtered.map((t) => {
                const wsName = workspaceName(t.workspaceId)
                const terminals = terminalCounts[t.id] ?? 0
                const commands = commandCounts[t.id] ?? 0
                return (
                  <div
                    key={t.id}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open template ${t.name}`}
                    className="group relative flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-700 hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    onClick={() => navigateToTemplate(t.id)}
                    onKeyDown={(e) => handleTemplateCardKeyDown(e, t.id)}
                  >
                    {/* Actions */}
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          startEdit(t)
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700"
                      >
                        <RiEditLine className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(t.id)
                        }}
                        className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700"
                      >
                        <RiDeleteBinLine className="size-3.5" />
                      </button>
                    </div>

                    {/* Name + scope */}
                    <div className="flex items-start gap-2 pr-14">
                      <span className="text-[13px] font-medium text-zinc-200 leading-tight line-clamp-2">{t.name}</span>
                    </div>

                    {/* Description */}
                    {t.templateDescription && (
                      <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{t.templateDescription}</p>
                    )}

                    {/* Footer: counts + scope badge */}
                    <div className="flex items-center gap-3 mt-auto pt-1">
                      {terminals > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                          <RiTerminalBoxLine className="size-3" />
                          {terminals}
                        </span>
                      )}
                      {commands > 0 && (
                        <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                          <RiCommandLine className="size-3" />
                          {commands}
                        </span>
                      )}
                      <div className="flex-1" />
                      {wsName ? (
                        <Badge variant="outline" className="text-[10px]">
                          {wsName}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          <RiGlobalLine className="size-2.5" />
                          Global
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingId} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <Input placeholder="Template name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            <Input
              placeholder="Description (optional)"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingId(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={!editName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-80" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              placeholder="Template name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && createName.trim()) handleCreate()
              }}
              autoFocus
            />
            <Input
              placeholder="Description (optional)"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
            />
            <div>
              <label className="text-[11px] font-medium text-zinc-400 mb-1 block">Scope</label>
              <select
                className="w-full h-7 rounded-md border border-zinc-700 bg-zinc-800 px-2 text-xs text-zinc-200 outline-none focus:border-zinc-500"
                value={createScope}
                onChange={(e) => setCreateScope(e.target.value)}
              >
                <option value="global">Global (all workspaces)</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!createName.trim()} onClick={handleCreate}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
