// -----------------------------------------------------------------------------
// IconButton — square hit target with a prominent icon. Used for the
// attachment + send actions in the composer. Kept separate from PillButton
// so the icon isn't constrained to the pill's text-size.
// -----------------------------------------------------------------------------

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react'
import { cn } from '../cn'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: ReactNode
  readonly variant?: 'ghost' | 'solid' | 'danger'
  readonly size?: 'sm' | 'md' | 'lg'
  readonly label: string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        'transition-colors duration-150',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' && 'h-7 w-7 [&_svg]:size-[14px]',
        size === 'md' && 'h-8 w-8 [&_svg]:size-[16px]',
        size === 'lg' && 'h-9 w-9 [&_svg]:size-[18px]',
        variant === 'ghost' && 'text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground',
        variant === 'solid' &&
          'bg-foreground text-background hover:bg-foreground/90 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]',
        variant === 'danger' && 'text-destructive hover:bg-destructive/10',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})
