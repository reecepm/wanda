import React, { useCallback, useRef, useState } from 'react'
import { cn } from '@/shared/utils'

interface TaskIdentifierProps {
  identifier: string
  sequenceId: number | null
  className?: string
}

export const TaskIdentifier = React.memo(function TaskIdentifier({
  identifier,
  sequenceId,
  className,
}: TaskIdentifierProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const shortId = sequenceId == null ? '' : `${identifier}-${sequenceId}`

  const copyIdentifier = useCallback(() => {
    navigator.clipboard.writeText(shortId)
    setCopied(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 1500)
  }, [shortId])

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      copyIdentifier()
    },
    [copyIdentifier],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      event.stopPropagation()
      copyIdentifier()
    },
    [copyIdentifier],
  )

  if (sequenceId == null) return null

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      title={copied ? 'Copied!' : `Copy ${shortId}`}
      className={cn(
        'text-muted-foreground text-xs font-mono shrink-0 hover:text-foreground transition-colors cursor-copy select-none',
        copied && 'text-emerald-400',
        className,
      )}
    >
      {shortId}
    </span>
  )
})
