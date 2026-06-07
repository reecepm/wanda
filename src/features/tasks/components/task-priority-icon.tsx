import React from 'react'
import { cn } from '@/shared/utils'

interface TaskPriorityIconProps {
  priority: number
  className?: string
}

export const TaskPriorityIcon = React.memo(function TaskPriorityIcon({ priority, className }: TaskPriorityIconProps) {
  const classes = cn('size-3.5', className)

  // Priority 4: Urgent — filled alert icon
  if (priority === 4) {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-orange-500')}>
        <path d="M7 1L13 12H1L7 1Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        <path d="M7 5.5V8.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="10.25" r="0.75" fill="white" />
      </svg>
    )
  }

  // Priority 3: High — 3 signal bars
  if (priority === 3) {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-orange-400')}>
        <rect x="1" y="9" width="3" height="4" rx="0.5" fill="currentColor" />
        <rect x="5.5" y="5.5" width="3" height="7.5" rx="0.5" fill="currentColor" />
        <rect x="10" y="2" width="3" height="11" rx="0.5" fill="currentColor" />
      </svg>
    )
  }

  // Priority 2: Medium — 2 signal bars
  if (priority === 2) {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-yellow-500')}>
        <rect x="1" y="9" width="3" height="4" rx="0.5" fill="currentColor" />
        <rect x="5.5" y="5.5" width="3" height="7.5" rx="0.5" fill="currentColor" />
        <rect x="10" y="2" width="3" height="11" rx="0.5" fill="currentColor" opacity="0.2" />
      </svg>
    )
  }

  // Priority 1: Low — 1 signal bar
  if (priority === 1) {
    return (
      <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-blue-400')}>
        <rect x="1" y="9" width="3" height="4" rx="0.5" fill="currentColor" />
        <rect x="5.5" y="5.5" width="3" height="7.5" rx="0.5" fill="currentColor" opacity="0.2" />
        <rect x="10" y="2" width="3" height="11" rx="0.5" fill="currentColor" opacity="0.2" />
      </svg>
    )
  }

  // Priority 0: None — three dots
  return (
    <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-muted-foreground')}>
      <circle cx="3" cy="7" r="1.25" fill="currentColor" />
      <circle cx="7" cy="7" r="1.25" fill="currentColor" />
      <circle cx="11" cy="7" r="1.25" fill="currentColor" />
    </svg>
  )
})
