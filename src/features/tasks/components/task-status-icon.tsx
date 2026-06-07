import type { TaskStatus } from '@wanda/tasks'
import React from 'react'
import { cn } from '@/shared/utils'

interface TaskStatusIconProps {
  status: TaskStatus
  className?: string
}

export const TaskStatusIcon = React.memo(function TaskStatusIcon({ status, className }: TaskStatusIconProps) {
  const classes = cn('size-3.5', className)

  switch (status) {
    case 'draft':
      // Dashed circle outline
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-gray-400')}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
        </svg>
      )

    case 'pending':
      // Dotted circle outline
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-gray-400')}>
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="1.5 2"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )

    case 'ready':
      // Empty circle outline
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-blue-500')}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      )

    case 'in_progress':
      // Half-filled circle
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-amber-500')}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <path d="M7 1.5A5.5 5.5 0 0 0 7 12.5V1.5Z" fill="currentColor" />
        </svg>
      )

    case 'completed':
      // Filled circle with checkmark
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-emerald-500')}>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path
            d="M4.5 7L6.25 8.75L9.5 5.5"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )

    case 'failed':
      // Circle with X
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-red-500')}>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M5 5L9 9M9 5L5 9" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )

    case 'blocked':
      // Circle with horizontal dash
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-orange-500')}>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.5 7H9.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )

    default:
      return (
        <svg viewBox="0 0 14 14" fill="none" className={cn(classes, 'text-gray-400')}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      )
  }
})
