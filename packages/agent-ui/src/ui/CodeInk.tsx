// -----------------------------------------------------------------------------
// CodeInk — a dark "terminal ink" panel used for shell commands and
// command output previews. Keeps a consistent feel regardless of theme.
// -----------------------------------------------------------------------------

import type { ReactNode } from 'react'
import { cn } from '../cn'

export function CodeInk({ children, className, prompt }: { children: ReactNode; className?: string; prompt?: string }) {
  return (
    <pre
      className={cn(
        'overflow-x-auto rounded-md bg-zinc-950/95 px-3 py-2 font-mono text-[12px] leading-[1.55] text-zinc-100 ring-1 ring-inset ring-white/5',
        'dark:bg-zinc-900/80 dark:ring-white/10',
        className,
      )}
    >
      {prompt && <span className="select-none text-amber-400/90">{prompt} </span>}
      {children}
    </pre>
  )
}
