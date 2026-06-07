import type { TaskStatus } from '@wanda/tasks'
import React, { useCallback } from 'react'
import { cn } from '@/shared/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { TaskStatusIcon } from './task-status-icon'

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

interface TaskStatusSelectProps {
  value: TaskStatus
  onChange?: (status: TaskStatus) => void
  readonly?: boolean
  className?: string
}

export const TaskStatusSelect = React.memo(function TaskStatusSelect({
  value,
  onChange,
  readonly,
  className,
}: TaskStatusSelectProps) {
  const handleChange = useCallback(
    (v: TaskStatus | null) => {
      // The Select emits null when its value is cleared; TaskStatus has no
      // null member, so ignore the event rather than forwarding a bad value.
      if (v == null) return
      onChange?.(v)
    },
    [onChange],
  )

  if (readonly || !onChange) {
    return <TaskStatusIcon status={value} className={className} />
  }

  return (
    <Select value={value} onValueChange={handleChange}>
      <SelectTrigger
        size="sm"
        className={cn(
          'border-none bg-transparent! shadow-none p-0 h-auto w-auto min-w-0 gap-0 focus-visible:ring-0 hover:bg-transparent! hover:brightness-150 [&>:last-child]:hidden',
          className,
        )}
      >
        <SelectValue placeholder={<TaskStatusIcon status={value} />}>
          <TaskStatusIcon status={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-2">
              <TaskStatusIcon status={opt.value} />
              <span className="text-xs">{opt.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})

export { STATUS_OPTIONS }
