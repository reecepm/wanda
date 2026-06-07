import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Task, TaskStatus, TaskType } from '@wanda/tasks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RiDeleteBinLine, RiLoader4Line } from '@/lib/icons'
import { orpcUtils } from '@/shared/orpc'
import { Button } from '@/ui/button'
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle } from '@/ui/drawer'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { Separator } from '@/ui/separator'
import { TaskPrioritySelect } from './task-priority-select'
import { TaskStatusSelect } from './task-status-select'

interface TaskDetailPanelProps {
  taskId: string | null
  onClose: () => void
}

export function TaskDetailPanel({ taskId, onClose }: TaskDetailPanelProps) {
  return (
    <Drawer direction="right" open={!!taskId} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="h-full w-80 sm:max-w-80">
        {taskId && <TaskDetailContent taskId={taskId} onClose={onClose} />}
      </DrawerContent>
    </Drawer>
  )
}

const TYPES: TaskType[] = ['task', 'milestone', 'epic', 'subtask']
type TaskUpdateInput = Parameters<typeof orpcUtils.tasks.update.call>[0]
type TaskUpdatePatch = Omit<TaskUpdateInput, 'id' | 'expectedVersion'>

function TaskDetailContent({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const portalRef = useRef<HTMLDivElement>(null)
  const { data: task, isLoading } = useQuery(orpcUtils.tasks.get.queryOptions({ input: { id: taskId } })) as {
    data: Task | undefined
    isLoading: boolean
  }
  const [deleting, setDeleting] = useState(false)

  // Debounced field updates
  const updateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pendingUpdatesRef = useRef<Partial<TaskUpdatePatch>>({})
  const taskVersionRef = useRef(task?.version ?? 0)
  taskVersionRef.current = task?.version ?? 0

  const flushUpdate = useCallback(() => {
    clearTimeout(updateTimerRef.current)
    const updates = pendingUpdatesRef.current
    pendingUpdatesRef.current = {}
    if (Object.keys(updates).length === 0) return
    orpcUtils.tasks.update
      .call({ id: taskId, expectedVersion: taskVersionRef.current, ...updates })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.get.key({ input: { id: taskId } }) })
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
      })
      .catch((err) => {
        console.error('[task-detail] updateTask failed:', err)
        // Refetch to restore correct state
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.get.key({ input: { id: taskId } }) })
      })
  }, [taskId, queryClient])

  // Flush on unmount
  useEffect(() => () => flushUpdate(), [flushUpdate])

  const debouncedUpdate = useCallback(
    <K extends keyof TaskUpdatePatch>(field: K, value: TaskUpdatePatch[K]) => {
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, [field]: value }
      clearTimeout(updateTimerRef.current)
      updateTimerRef.current = setTimeout(flushUpdate, 500)
    },
    [flushUpdate],
  )

  const immediateUpdate = useCallback(
    <K extends keyof TaskUpdatePatch>(field: K, value: TaskUpdatePatch[K]) => {
      // Optimistic update in cache
      queryClient.setQueryData(orpcUtils.tasks.get.queryKey({ input: { id: taskId } }), (old: typeof task) =>
        old ? { ...old, [field]: value } : old,
      )
      pendingUpdatesRef.current = { ...pendingUpdatesRef.current, [field]: value }
      clearTimeout(updateTimerRef.current)
      flushUpdate()
    },
    [taskId, queryClient, flushUpdate],
  )

  if (isLoading || !task) {
    return (
      <div className="flex items-center justify-center h-full">
        <RiLoader4Line className="size-4 text-zinc-600 animate-spin" />
      </div>
    )
  }

  function handleStatusChange(newStatus: TaskStatus) {
    if (newStatus === task!.status) return
    immediateUpdate('status', newStatus)
  }

  async function refreshTask() {
    await queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.get.key({ input: { id: taskId } }) })
    await queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
  }

  async function handleClaim(agentId: string) {
    queryClient.setQueryData(orpcUtils.tasks.get.queryKey({ input: { id: taskId } }), (old: typeof task) =>
      old ? { ...old, claimedBy: agentId } : old,
    )
    try {
      await orpcUtils.tasks.claim.call({ id: taskId, agentId })
    } finally {
      await refreshTask()
    }
  }

  async function handleRelease() {
    queryClient.setQueryData(orpcUtils.tasks.get.queryKey({ input: { id: taskId } }), (old: typeof task) =>
      old ? { ...old, claimedBy: null, claimedAt: null, leaseExpiresAt: null } : old,
    )
    try {
      await orpcUtils.tasks.release.call({ id: taskId })
    } finally {
      await refreshTask()
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await orpcUtils.tasks.delete.call({ id: taskId })
      queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
      onClose()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <DrawerHeader className="flex flex-row items-center justify-between gap-2 px-3 py-2 h-9 border-b border-zinc-800">
        <DrawerTitle className="text-xs font-medium text-zinc-300 truncate">{task.title}</DrawerTitle>
        <DrawerClose className="p-1 text-zinc-500 hover:text-zinc-300 shrink-0" />
      </DrawerHeader>

      <div ref={portalRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Title */}
        <EditableField
          key={`title:${task.id}:${task.title ?? ''}`}
          label="Title"
          value={task.title ?? ''}
          onChange={(v) => debouncedUpdate('title', v)}
        />

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Status</span>
          <TaskStatusSelect value={task.status} onChange={(s) => handleStatusChange(s)} />
        </div>

        {/* Priority */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Priority</span>
          <TaskPrioritySelect value={task.priority} onChange={(p) => immediateUpdate('priority', p)} />
        </div>

        {/* Type */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Type</span>
          <Select value={task.type ?? 'task'} onValueChange={(v) => immediateUpdate('type', v as TaskType)}>
            <SelectTrigger size="sm" className="h-6 px-2 text-[11px] border-zinc-800 bg-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" sideOffset={4} alignItemWithTrigger={false} container={portalRef}>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Assignee */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Assignee</span>
          <div className="flex items-center gap-1.5">
            {task.claimedBy ? (
              <>
                <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium flex items-center justify-center">
                  {task.claimedBy.charAt(0).toUpperCase()}
                </span>
                <span className="text-xs text-zinc-400">{task.claimedBy}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 text-[10px] text-zinc-500"
                  onClick={handleRelease}
                >
                  Remove
                </Button>
              </>
            ) : (
              <AssigneeInput onAssign={handleClaim} />
            )}
          </div>
        </div>

        {task.createdBy && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-500">Created by</span>
            <span className="text-xs text-zinc-400">{task.createdBy}</span>
          </div>
        )}

        <Separator />

        {/* Description */}
        <EditableTextarea
          key={`description:${task.id}:${task.description ?? ''}`}
          label="Description"
          value={task.description ?? ''}
          onChange={(v) => debouncedUpdate('description', v || undefined)}
          placeholder="Add a description..."
        />

        {/* Content */}
        <EditableTextarea
          key={`content:${task.id}:${task.content ?? ''}`}
          label="Content"
          value={task.content ?? ''}
          onChange={(v) => debouncedUpdate('content', v || undefined)}
          placeholder="Add content..."
          mono
        />

        {(task.dependsOn?.length ?? 0) > 0 && (
          <>
            <Separator />
            <div>
              <span className="text-[10px] text-zinc-500">Dependencies</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {task.dependsOn?.map((dep: string) => (
                  <span key={dep} className="text-[10px] bg-zinc-800 text-zinc-400 rounded-md px-1.5 py-0.5 font-mono">
                    {dep.slice(0, 8)}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        {Object.keys(task.labels ?? {}).length > 0 && (
          <>
            <Separator />
            <div>
              <span className="text-[10px] text-zinc-500">Labels</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(task.labels ?? {}).map(([k, v]) => (
                  <span key={k} className="text-[10px] bg-zinc-800 text-zinc-400 rounded-md px-1.5 py-0.5">
                    {k}: {String(v)}
                  </span>
                ))}
              </div>
            </div>
          </>
        )}

        <Separator />

        <div className="text-[10px] text-zinc-600 space-y-0.5 select-text">
          <div>
            ID: <span className="font-mono">{task.id}</span>
          </div>
          <div>Created: {task.createdAt ? new Date(task.createdAt).toLocaleString() : '-'}</div>
          <div>Updated: {task.updatedAt ? new Date(task.updatedAt).toLocaleString() : '-'}</div>
        </div>

        <Separator />

        <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
          <RiDeleteBinLine className="size-3" />
          Delete
        </Button>
      </div>
    </>
  )
}

/** Inline editable single-line text field */
function EditableField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const [local, setLocal] = useState(value)

  return (
    <div>
      <span className="text-[10px] text-zinc-500">{label}</span>
      <input
        value={local}
        onChange={(e) => {
          setLocal(e.target.value)
          onChange(e.target.value)
        }}
        className="w-full mt-0.5 bg-transparent text-xs text-zinc-200 border-b border-transparent hover:border-zinc-700 focus:border-zinc-500 outline-none py-0.5 transition-colors"
      />
    </div>
  )
}

/** Inline editable textarea */
function EditableTextarea({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
}) {
  const [local, setLocal] = useState(value)

  return (
    <div>
      <span className="text-[10px] text-zinc-500">{label}</span>
      <textarea
        value={local}
        onChange={(e) => {
          setLocal(e.target.value)
          onChange(e.target.value)
        }}
        placeholder={placeholder}
        rows={2}
        className={`w-full mt-0.5 bg-transparent text-xs text-zinc-300 border border-transparent rounded-md hover:border-zinc-800 focus:border-zinc-700 outline-none p-1.5 resize-none transition-colors placeholder:text-zinc-700 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}

/** Small inline input to assign someone */
function AssigneeInput({ onAssign }: { onAssign: (value: string) => void }) {
  const [value, setValue] = useState('')

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (value.trim()) {
          onAssign(value.trim())
          setValue('')
        }
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Assign..."
        className="w-24 h-5 bg-transparent text-xs text-zinc-300 border-b border-zinc-700 outline-none placeholder:text-zinc-600"
      />
      {value.trim() && (
        <Button type="submit" variant="ghost" size="sm" className="h-5 px-1 text-[10px]">
          Set
        </Button>
      )}
    </form>
  )
}
