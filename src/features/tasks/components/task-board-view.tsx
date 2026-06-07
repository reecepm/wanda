import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { Task, TaskStatus } from '@wanda/tasks'
import { useCallback, useState } from 'react'
import { TaskPriorityIcon } from './task-priority-icon'
import { TaskStatusIcon } from './task-status-icon'

interface TaskBoardViewProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  projectIdentifierMap?: Map<string, string>
}

const BOARD_COLUMNS: TaskStatus[] = ['pending', 'ready', 'in_progress', 'completed', 'failed', 'blocked']

export function TaskBoardView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onUpdateField,
  projectIdentifierMap,
}: TaskBoardViewProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [overColumn, setOverColumn] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const tasksByStatus = new Map<string, Task[]>()
  for (const col of BOARD_COLUMNS) {
    tasksByStatus.set(col, [])
  }
  for (const task of tasks) {
    const existing = tasksByStatus.get(task.status ?? '')
    if (existing) existing.push(task)
  }

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = tasks.find((t) => t.id === event.active.id)
      if (task) setActiveTask(task)
    },
    [tasks],
  )

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined
    if (overId && BOARD_COLUMNS.includes(overId as TaskStatus)) {
      setOverColumn(overId)
    } else {
      setOverColumn(null)
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null)
      setOverColumn(null)

      const taskId = event.active.id as string
      const overId = event.over?.id as string | undefined
      if (!overId) return

      let targetStatus = overId
      if (!BOARD_COLUMNS.includes(overId as TaskStatus)) {
        const overTask = tasks.find((t) => t.id === overId)
        if (overTask) targetStatus = overTask.status ?? overId
      }

      const task = tasks.find((t) => t.id === taskId)
      if (!task || task.status === targetStatus) return

      onUpdateField(taskId, 'status', targetStatus)
    },
    [tasks, onUpdateField],
  )

  const activeShortId =
    activeTask?.projectId && activeTask.sequenceId != null
      ? `${projectIdentifierMap?.get(activeTask.projectId) ?? ''}-${activeTask.sequenceId}`
      : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 p-3 h-full overflow-x-auto">
        {BOARD_COLUMNS.map((status) => {
          const columnTasks = tasksByStatus.get(status) ?? []
          const isOver = overColumn === status && activeTask?.status !== status
          return (
            <BoardColumn
              key={status}
              status={status}
              tasks={columnTasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
              projectIdentifierMap={projectIdentifierMap}
              isOver={isOver}
            />
          )
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="w-72 rounded-lg border border-border bg-card p-3 shadow-xl opacity-90">
            <div className="flex items-center justify-between gap-2 mb-1">
              {activeShortId && <span className="text-muted-foreground text-xs font-mono">{activeShortId}</span>}
              {activeTask.claimedBy && (
                <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium flex items-center justify-center shrink-0">
                  {activeTask.claimedBy.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground truncate mb-1.5">{activeTask.title}</p>
            <div className="flex items-center gap-2">
              <TaskStatusIcon status={activeTask.status} />
              <TaskPriorityIcon priority={activeTask.priority} />
            </div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumn({
  status,
  tasks,
  selectedTaskId,
  onSelectTask,
  projectIdentifierMap,
  isOver,
}: {
  status: string
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  projectIdentifierMap?: Map<string, string>
  isOver: boolean
}) {
  return (
    <div
      className={`flex flex-col w-72 shrink-0 rounded-lg transition-colors ${
        isOver ? 'bg-accent/30 ring-1 ring-border' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1.5 mb-1">
        <TaskStatusIcon status={status as TaskStatus} />
        <span className="text-xs font-medium text-foreground capitalize">{status.replace('_', ' ')}</span>
        <span className="text-[10px] text-muted-foreground ml-0.5">{tasks.length}</span>
      </div>
      <DroppableArea id={status}>
        {tasks.map((task) => (
          <DraggableCard
            key={task.id}
            task={task}
            isSelected={selectedTaskId === task.id}
            onSelect={() => onSelectTask(task.id)}
            projectIdentifier={task.projectId ? projectIdentifierMap?.get(task.projectId) : undefined}
          />
        ))}
      </DroppableArea>
    </div>
  )
}

function DroppableArea({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 overflow-y-auto space-y-2 p-1 rounded-md min-h-16 transition-colors ${
        isOver ? 'bg-accent/20' : ''
      }`}
    >
      {children}
    </div>
  )
}

function DraggableCard({
  task,
  isSelected,
  onSelect,
  projectIdentifier,
}: {
  task: Task
  isSelected: boolean
  onSelect: () => void
  projectIdentifier?: string
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })

  const labels = task.labels ? Object.entries(task.labels).slice(0, 2) : []
  const assigneeInitial = task.claimedBy ? task.claimedBy.charAt(0).toUpperCase() : null
  const shortId = projectIdentifier && task.sequenceId != null ? `${projectIdentifier}-${task.sequenceId}` : null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`w-full text-left rounded-lg border p-3 transition-all ${
        isDragging
          ? 'opacity-30'
          : isSelected
            ? 'border-primary/60 bg-card shadow-sm'
            : 'border-border bg-card hover:border-border/80 hover:shadow-sm'
      }`}
    >
      {/* Top: short ID + assignee */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        {shortId ? <span className="text-muted-foreground text-xs font-mono select-text">{shortId}</span> : <span />}
        {assigneeInitial && (
          <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium flex items-center justify-center shrink-0">
            {assigneeInitial}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm text-foreground line-clamp-2 leading-relaxed mb-3">{task.title}</p>

      {/* Bottom: priority + labels + date */}
      <div className="flex items-center gap-2">
        <TaskPriorityIcon priority={task.priority} className="shrink-0" />

        {labels.length > 0 && (
          <span className="flex items-center gap-1 min-w-0 flex-1">
            {labels.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 truncate"
              >
                <span className="size-1.5 rounded-full bg-current opacity-60 shrink-0" />
                {value || key}
              </span>
            ))}
          </span>
        )}

        {task.createdAt && (
          <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">
            {formatRelativeTime(task.createdAt)}
          </span>
        )}
      </div>
    </div>
  )
}

import { formatRelativeTime } from '@/features/tasks/utils/task-filters'
