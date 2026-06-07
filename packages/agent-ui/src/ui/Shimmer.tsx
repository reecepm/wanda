// -----------------------------------------------------------------------------
// Shimmer — a small bit of live-text that breathes while the model is
// thinking but has not yet emitted user-visible output. Uses a
// background-clip: text gradient animation driven by CSS custom keyframes.
// -----------------------------------------------------------------------------

import { cn } from '../cn'

export function Shimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('agent-shimmer inline-block bg-clip-text text-transparent', className)}>{children}</span>
}

export function ShimmerDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-1.5 w-1.5 items-center justify-center', className)}>
      <span className="absolute inset-0 rounded-full bg-foreground/60 [animation:agent-dot-ping_1.4s_ease-in-out_infinite]" />
      <span className="relative h-1.5 w-1.5 rounded-full bg-foreground/80" />
    </span>
  )
}
