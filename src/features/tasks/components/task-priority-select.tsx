import React, { useCallback } from 'react'
import { cn } from '@/shared/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select'
import { TaskPriorityIcon } from './task-priority-icon'

const PRIORITY_OPTIONS = [
  { value: 0, label: 'No priority' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Urgent' },
] as const

interface TaskPrioritySelectProps {
  value: number
  onChange?: (priority: number) => void
  readonly?: boolean
  className?: string
}

export const TaskPrioritySelect = React.memo(function TaskPrioritySelect({
  value,
  onChange,
  readonly,
  className,
}: TaskPrioritySelectProps) {
  const handleChange = useCallback(
    (v: number | null) => {
      // Select emits null when the value is cleared — for priority, a null
      // cleared selection maps to "No priority" (0).
      onChange?.(v ?? 0)
    },
    [onChange],
  )

  if (readonly || !onChange) {
    return <TaskPriorityIcon priority={value} className={className} />
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
        <SelectValue placeholder={<TaskPriorityIcon priority={value} />}>
          <TaskPriorityIcon priority={value} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {PRIORITY_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            <span className="flex items-center gap-2">
              <TaskPriorityIcon priority={opt.value} />
              <span className="text-xs">{opt.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})

export { PRIORITY_OPTIONS }
