import { RiCheckLine } from '@/lib/icons'
import { cn } from '@/shared/utils'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/ui/command'
import type { FilterOption } from './types'

interface FilterValueSelectorProps {
  options: FilterOption[]
  selected: string[]
  onToggle: (value: string) => void
}

export function FilterValueSelector({ options, selected, onToggle }: FilterValueSelectorProps) {
  const selectedSet = new Set(selected)

  return (
    <Command>
      <CommandInput placeholder="Search..." />
      <CommandList>
        <CommandEmpty>No options found.</CommandEmpty>
        <CommandGroup>
          {options.map((opt) => {
            const isSelected = selectedSet.has(opt.value)
            return (
              <CommandItem
                key={opt.value}
                value={opt.label}
                onSelect={() => onToggle(opt.value)}
                data-checked={isSelected}
                className="[&_svg.ml-auto]:hidden"
              >
                <div
                  className={cn(
                    'flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-input transition-colors',
                    isSelected && 'border-primary bg-primary text-primary-foreground',
                  )}
                >
                  {isSelected && <RiCheckLine className="size-2.5" />}
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
