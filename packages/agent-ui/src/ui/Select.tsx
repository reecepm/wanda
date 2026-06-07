// -----------------------------------------------------------------------------
// Select — lightweight wrapper around Ariakit MenuProvider/Menu.
//
// Opens downward into a floating popover. Options render inside the popover;
// an optional "Auto" (null) entry lets consumers clear the selection.
// -----------------------------------------------------------------------------

import { Menu, MenuButton, MenuItem, MenuProvider } from '@ariakit/react'
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconCheck, IconChevronDown } from './icons'

export interface SelectOption<T extends string> {
  readonly id: T | null
  readonly label: string
  readonly description?: string
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  placement = 'top',
}: {
  label: string
  value: T | null
  options: ReadonlyArray<SelectOption<T>>
  onChange: (next: T | null) => void
  disabled?: boolean
  placement?: 'top' | 'bottom'
}) {
  const current = options.find((o) => o.id === value)
  const currentLabel = current?.label ?? 'Auto'
  const trigger = (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px]',
        'text-muted-foreground transition-colors',
        'hover:bg-foreground/[0.06] hover:text-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        'data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/90">{label}</span>
      <span className="truncate text-foreground">{currentLabel}</span>
      <IconChevronDown className="opacity-60" />
    </button>
  )
  return (
    <MenuProvider placement={placement === 'top' ? 'top-start' : 'bottom-start'}>
      <MenuButton render={trigger} />
      <Menu
        gutter={6}
        className={cn(
          'z-50 min-w-[10rem] rounded-lg border-[0.5px] border-border bg-popover p-1 text-popover-foreground',
          'shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur',
          'outline-none',
        )}
      >
        {options.map((o) => {
          const selected = o.id === value
          return (
            <MenuItem
              key={o.id ?? '__null__'}
              onClick={() => onChange(o.id)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px]',
                'outline-none',
                'data-[active-item]:bg-foreground/[0.08]',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                {selected ? <IconCheck /> : null}
              </span>
              <span className="flex flex-col leading-tight">
                <span className="text-foreground">{o.label}</span>
                {o.description && <span className="font-mono text-[10px] text-muted-foreground">{o.description}</span>}
              </span>
            </MenuItem>
          )
        })}
      </Menu>
    </MenuProvider>
  )
}

export function SelectTriggerShape({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1">{children}</span>
}
