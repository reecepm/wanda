import type { Task, TaskStatus } from '@wanda/tasks'
import React from 'react'
import { formatRelativeTime } from '@/features/tasks/utils/task-filters'
import { cn } from '@/shared/utils'
import { Checkbox } from '@/ui/checkbox'
import { TaskPrioritySelect } from './task-priority-select'
import { TaskRowContextMenu } from './task-row-context-menu'
import { TaskStatusSelect } from './task-status-select'

interface TaskRowProps {
  task: Task
  selected: boolean
  checked: boolean
  onSelect: (id: string) => void
  onCheck: (id: string, checked: boolean) => void
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  projectIdentifier?: string
}

export const TaskRow = React.memo(function TaskRow({
  task,
  selected,
  checked,
  onSelect,
  onCheck,
  onUpdateField,
  projectIdentifier,
}: TaskRowProps) {
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
          'group w-full flex items-center gap-2 pl-2 pr-3 h-9 text-left transition-colors border-b border-border/40',
          selected ? 'bg-accent/60 border-l-2 border-l-primary' : 'hover:bg-accent/30',
        )}
      >
        {/* Checkbox — hidden until hover or checked */}
        <div
          className={cn(
            'shrink-0 flex items-center justify-center w-5 transition-opacity',
            checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox checked={checked} onCheckedChange={(v) => onCheck(task.id, v === true)} />
        </div>

        {/* Priority — inline dropdown */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <TaskPrioritySelect value={task.priority} onChange={(p) => onUpdateField(task.id, 'priority', p)} />
        </div>

        {/* Short identifier */}
        {shortId && (
          <span className="text-muted-foreground text-xs font-mono shrink-0 w-16 text-right select-text">
            {shortId}
          </span>
        )}

        {/* Status — inline dropdown */}
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <TaskStatusSelect value={task.status} onChange={(s: TaskStatus) => onUpdateField(task.id, 'status', s)} />
        </div>

        {/* Title */}
        <span className="text-xs text-foreground truncate flex-1 min-w-0">{task.title}</span>

        {/* Right section */}
        <span className="flex items-center gap-2.5 shrink-0">
          {labels.length > 0 && (
            <span className="flex items-center gap-1">
              {labels.map(([key, value]) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5"
                >
                  <span className="size-1.5 rounded-full bg-current opacity-60" />
                  {value || key}
                </span>
              ))}
            </span>
          )}

          {task.createdAt && (
            <span className="text-xs text-muted-foreground w-14 text-right">{formatRelativeTime(task.createdAt)}</span>
          )}

          {assigneeInitial ? (
            <span className="size-5 rounded-full bg-muted text-muted-foreground text-[10px] font-medium flex items-center justify-center shrink-0">
              {assigneeInitial}
            </span>
          ) : (
            <span className="size-5 shrink-0" />
          )}
        </span>
      </div>
    </TaskRowContextMenu>
  )
})
