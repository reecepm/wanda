import type { Task, TaskStatus } from '@wanda/tasks'
import type React from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/ui/context-menu'
import { TaskPriorityIcon } from './task-priority-icon'
import { TaskStatusIcon } from './task-status-icon'

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

const PRIORITIES = [
  { value: 0, label: 'No priority' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
]

interface TaskRowContextMenuProps {
  task: Task
  shortId: string | null
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  children: React.ReactNode
}

export function TaskRowContextMenu({ task, shortId, onUpdateField, children }: TaskRowContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Status */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TaskStatusIcon status={task.status} className="mr-2" />
            Status
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {STATUSES.map((s) => (
              <ContextMenuItem
                key={s.value}
                disabled={s.value === task.status}
                onSelect={() => onUpdateField(task.id, 'status', s.value)}
              >
                <TaskStatusIcon status={s.value} className="mr-2" />
                {s.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Priority */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <TaskPriorityIcon priority={task.priority} className="mr-2" />
            Priority
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {PRIORITIES.map((p) => (
              <ContextMenuItem
                key={p.value}
                disabled={p.value === task.priority}
                onSelect={() => onUpdateField(task.id, 'priority', p.value)}
              >
                <TaskPriorityIcon priority={p.value} className="mr-2" />
                {p.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        {/* Assignee */}
        <ContextMenuSub>
          <ContextMenuSubTrigger>Assignee</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {task.claimedBy ? (
              <ContextMenuItem onSelect={() => onUpdateField(task.id, 'claimedBy', null)}>Unassign</ContextMenuItem>
            ) : (
              <ContextMenuItem disabled>No assignee</ContextMenuItem>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        {/* Copy actions */}
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(task.title)}>Copy title</ContextMenuItem>
        {shortId && (
          <ContextMenuItem onSelect={() => navigator.clipboard.writeText(shortId)}>
            Copy identifier ({shortId})
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => navigator.clipboard.writeText(task.id)}>Copy ID</ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={() => onUpdateField(task.id, '_delete', true)}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
