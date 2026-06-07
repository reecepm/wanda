import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTaskStore } from '@/features/tasks/store/task-store'
import { RiAddLine, RiCloseLine, RiEditLine, RiFileCopyLine, RiKanbanView, RiListUnordered } from '@/lib/icons'
import { useInlineEdit } from '@/shared/hooks/use-inline-edit'
import { orpcUtils } from '@/shared/orpc'
import type { TaskViewConfig } from '@/types/schema'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu'

interface TaskViewTabStripProps {
  views: { id: string; name: string; config: TaskViewConfig; sortOrder: number }[]
}

const DEFAULT_CONFIG: TaskViewConfig = {
  filters: {},
  groupBy: 'status',
  sortBy: 'created',
  sortDirection: 'desc',
  layout: 'grouped-list',
  collapsedGroups: [],
  showCompletedTasks: false,
  fields: ['type', 'priority', 'project', 'created'],
}

export function TaskViewTabStrip({ views }: TaskViewTabStripProps) {
  const queryClient = useQueryClient()
  const activeViewId = useTaskStore((s) => s.activeViewId)
  const setActiveViewId = useTaskStore((s) => s.setActiveViewId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const updateViewMutation = useMutation({
    ...orpcUtils.taskView.update.mutationOptions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.taskView.list.key() })
    },
  })
  const createViewMutation = useMutation(orpcUtils.taskView.create.mutationOptions())
  const deleteViewMutation = useMutation({
    ...orpcUtils.taskView.delete.mutationOptions(),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: orpcUtils.taskView.list.key() })
      if (activeViewId === variables.id) {
        const remaining = views.filter((v) => v.id !== variables.id)
        setActiveViewId(remaining[0]?.id ?? null)
      }
    },
  })
  const {
    editValue,
    setEditValue,
    inputRef,
    startEditing: startEdit,
    commitRename: commitEdit,
    cancelEditing: cancelEdit,
  } = useInlineEdit((value) => {
    if (editingId) {
      updateViewMutation.mutate({ id: editingId, name: value })
    }
  })
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  function startEditing(viewId: string, name: string) {
    setEditingId(viewId)
    startEdit(name)
  }

  function commitRename() {
    commitEdit()
    setEditingId(null)
  }

  function handleCreate(layout: 'grouped-list' | 'board') {
    createViewMutation.mutate(
      {
        name: `View ${views.length + 1}`,
        config: { ...DEFAULT_CONFIG, layout },
        sortOrder: views.length,
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: orpcUtils.taskView.list.key() })
          setActiveViewId(result.id)
          setAddMenuOpen(false)
        },
      },
    )
  }

  function handleDuplicate(view: { id: string; name: string; config: TaskViewConfig }) {
    createViewMutation.mutate(
      {
        name: `${view.name} copy`,
        config: view.config,
        sortOrder: views.length,
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: orpcUtils.taskView.list.key() })
          setActiveViewId(result.id)
        },
      },
    )
  }

  function handleDelete(viewId: string) {
    deleteViewMutation.mutate({ id: viewId })
  }

  if (views.length === 0) return null

  return (
    <div role="tablist" aria-label="Task Views" className="flex items-center gap-0.5">
      {views.map((view) => {
        const isActive = view.id === activeViewId
        const isEditing = editingId === view.id

        return (
          <ContextMenu key={view.id}>
            <ContextMenuTrigger
              render={
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={`
                    relative px-2 py-1 text-[11px] rounded-md transition-colors
                    ${isActive ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}
                  `}
                  onClick={() => !isEditing && setActiveViewId(view.id)}
                  onDoubleClick={() => startEditing(view.id, view.name)}
                />
              }
            >
              {isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') {
                      cancelEdit()
                      setEditingId(null)
                    }
                    e.stopPropagation()
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-[11px] text-zinc-200 w-[60px] py-0 text-center"
                />
              ) : (
                view.name
              )}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => startEditing(view.id, view.name)}>
                <RiEditLine />
                Rename
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleDuplicate(view)}>
                <RiFileCopyLine />
                Duplicate
              </ContextMenuItem>
              {views.length > 1 && (
                <ContextMenuItem variant="destructive" onClick={() => handleDelete(view.id)}>
                  <RiCloseLine />
                  Delete
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}

      <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
        <DropdownMenuTrigger
          className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors outline-none"
          title="New view"
        >
          <RiAddLine className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-48">
          <DropdownMenuItem onClick={() => handleCreate('grouped-list')}>
            <RiListUnordered className="h-3.5 w-3.5 shrink-0" />
            Grouped List
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleCreate('board')}>
            <RiKanbanView className="h-3.5 w-3.5 shrink-0" />
            Board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
