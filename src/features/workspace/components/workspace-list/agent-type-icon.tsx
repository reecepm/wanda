import { ClaudeIcon, OpenAIIcon, OpenCodeIcon } from '@/features/icons'
import { cn } from '@/shared/utils'

export function AgentTypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'claude') return <ClaudeIcon className={cn('text-zinc-300', className)} />
  if (type === 'codex') return <OpenAIIcon className={cn('text-zinc-300', className)} />
  return <OpenCodeIcon className={cn('text-zinc-300', className)} />
}
