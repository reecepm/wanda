import type { Task, TaskStatus } from '@wanda/tasks'
import React from 'react'
import { formatRelativeTime } from '@/features/tasks/utils/task-filters'
import { cn } from '@/shared/utils'
import { TaskPrioritySelect } from './task-priority-select'
import { TaskRowContextMenu } from './task-row-context-menu'
import { TaskStatusSelect } from './task-status-select'

interface TaskCardProps {
  task: Task
  selected: boolean
  onSelect: (id: string) => void
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  projectIdentifier?: string
}

export const TaskCard = React.memo(function TaskCard({
  task,
  selected,
  onSelect,
  onUpdateField,
  projectIdentifier,
}: TaskCardProps) {
  const labels = task.labels ? Object.entries(task.labels).slice(0, 2) : []
  const assigneeInitial = task.claimedBy ? task.claimedBy.charAt(0).toUpperCase() : null
  const shortId = projectIdentifier && task.sequenceId != null ? `${projectIdentifier}-${task.sequenceId}` : null

  return (
    <TaskRowContextMenu task={task} shortId={shortId} onUpdateField={onUpdateField}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(task.id)
          }
        }}
        className={cn(
          'w-full text-left rounded-lg border bg-card p-2.5 transition-all',
          selected ? 'border-primary/60 shadow-sm' : 'border-border hover:border-border/80 hover:shadow-sm',
        )}
      >
        {/* Top row: identifier + assignee */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {shortId ? <span className="text-muted-foreground text-xs font-mono select-text">{shortId}</span> : <span />}

          {assigneeInitial && (
            <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium flex items-center justify-center shrink-0">
              {assigneeInitial}
            </span>
          )}
        </div>

        {/* Title */}
        <p className="text-xs text-foreground line-clamp-2 leading-relaxed mb-2">{task.title}</p>

        {/* Bottom row: status + priority + labels + date */}
        <div className="flex items-center gap-2">
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <TaskStatusSelect value={task.status} onChange={(s: TaskStatus) => onUpdateField(task.id, 'status', s)} />
          </div>

          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <TaskPrioritySelect value={task.priority} onChange={(p) => onUpdateField(task.id, 'priority', p)} />
          </div>

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
    </TaskRowContextMenu>
  )
})
