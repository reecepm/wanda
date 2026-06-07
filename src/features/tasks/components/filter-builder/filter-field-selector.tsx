import { useRef, useState } from 'react'
import { RiCheckLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/command'
import type { ActiveFilter, FilterFieldConfig } from './types'

interface FilterFieldSelectorProps {
  fields: FilterFieldConfig[]
  /** Current filters — used to derive checked state on the values page. */
  activeFilters: ActiveFilter[]
  /** Called on every toggle — caller updates filter state directly. */
  onToggleValue: (field: FilterFieldConfig, value: string) => void
}

export function FilterFieldSelector({ fields, activeFilters, onToggleValue }: FilterFieldSelectorProps) {
  const [activeField, setActiveField] = useState<FilterFieldConfig | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Derive which values are currently selected for the active field
  const selectedValues = new Set(
    activeField ? activeFilters.filter((f) => f.field === activeField.field).flatMap((f) => f.values) : [],
  )

  // Values page
  if (activeField) {
    return (
      <Command shouldFilter={true}>
        <CommandInput
          ref={inputRef}
          placeholder={`Search ${activeField.label.toLowerCase()}...`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setActiveField(null)
              return
            }
            if (e.key === 'Backspace' && inputRef.current?.value === '') {
              e.preventDefault()
              setActiveField(null)
            }
          }}
        />
        <CommandList>
          <CommandEmpty>No options.</CommandEmpty>
          <CommandGroup>
            {activeField.options.map((opt) => {
              const isChecked = selectedValues.has(opt.value)
              return (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => onToggleValue(activeField, opt.value)}
                  className="[&>svg.ml-auto]:hidden"
                >
                  <div
                    className={cn(
                      'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-input transition-colors',
                      isChecked && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {isChecked && <RiCheckLine className="size-2.5" />}
                  </div>
                  {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                  <span>{opt.label}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    )
  }

  // Fields page
  return (
    <Command shouldFilter={true}>
      <CommandInput placeholder="Filter by..." />
      <CommandList>
        <CommandEmpty>No fields.</CommandEmpty>
        <CommandGroup>
          {fields.map((f) => {
            const Icon = f.icon
            return (
              <CommandItem key={f.field} value={f.label} onSelect={() => setActiveField(f)}>
                <Icon className="size-3.5 text-muted-foreground" />
                {f.label}
              </CommandItem>
            )
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
