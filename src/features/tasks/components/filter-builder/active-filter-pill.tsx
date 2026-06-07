import { useState } from 'react'
import { RiCloseLine } from '@/lib/icons'
import { Command, CommandGroup, CommandItem, CommandList } from '@/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { FilterValueSelector } from './filter-value-selector'
import type { ActiveFilter, FilterFieldConfig, FilterOperator } from './types'

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'is', label: 'is' },
  { value: 'is not', label: 'is not' },
  { value: 'is any of', label: 'is any of' },
  { value: 'is none of', label: 'is none of' },
]

interface ActiveFilterPillProps {
  filter: ActiveFilter
  fieldConfig: FilterFieldConfig
  onChange: (filter: ActiveFilter) => void
  onRemove: () => void
}

export function ActiveFilterPill({ filter, fieldConfig, onChange, onRemove }: ActiveFilterPillProps) {
  const [operatorOpen, setOperatorOpen] = useState(false)
  const [valueOpen, setValueOpen] = useState(false)

  const Icon = fieldConfig.icon

  // Build the value display — matches Linear's pattern:
  // 0 values: "any"
  // 1 value: icon + label (e.g. "○ Ready" or "▲ High")
  // 2+ values: "2 statuses" / "3 priorities" etc.
  let valueDisplay: React.ReactNode
  if (filter.values.length === 0) {
    valueDisplay = <span className="text-muted-foreground">any</span>
  } else if (filter.values.length === 1) {
    const opt = fieldConfig.options.find((o) => o.value === filter.values[0])
    valueDisplay = (
      <span className="flex items-center gap-1.5">
        {opt?.icon && <span className="shrink-0">{opt.icon}</span>}
        <span>{opt?.label ?? filter.values[0]}</span>
      </span>
    )
  } else {
    const noun = fieldConfig.label.toLowerCase()
    // Pluralize simply
    const plural = noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`
    valueDisplay = (
      <span className="text-muted-foreground">
        {filter.values.length} {plural}
      </span>
    )
  }

  function handleOperatorChange(op: FilterOperator) {
    onChange({ ...filter, operator: op })
    setOperatorOpen(false)
  }

  function handleValueToggle(value: string) {
    const values = filter.values.includes(value) ? filter.values.filter((v) => v !== value) : [...filter.values, value]

    // Auto-switch operator when going from single to multi or vice versa
    let operator = filter.operator
    if (values.length > 1 && (operator === 'is' || operator === 'is not')) {
      operator = operator === 'is' ? 'is any of' : 'is none of'
    } else if (values.length <= 1 && (operator === 'is any of' || operator === 'is none of')) {
      operator = operator === 'is any of' ? 'is' : 'is not'
    }

    onChange({ ...filter, values, operator })
  }

  return (
    <div className="inline-flex items-center h-6 rounded-full bg-muted/60 border border-border/60 text-[11px] overflow-hidden">
      {/* Field segment — icon + label, not editable */}
      <span className="flex items-center gap-1 pl-2 pr-1.5 text-muted-foreground select-none">
        <Icon className="size-3" />
        <span className="font-medium">{fieldConfig.label}</span>
      </span>

      <span className="w-px h-3 bg-border/60" />

      {/* Operator segment — clickable */}
      <Popover open={operatorOpen} onOpenChange={setOperatorOpen}>
        <PopoverTrigger className="flex items-center px-1.5 h-full text-muted-foreground hover:text-foreground transition-colors outline-none">
          {filter.operator}
        </PopoverTrigger>
        <PopoverContent className="w-36 p-0" align="start" sideOffset={6}>
          <Command>
            <CommandList>
              <CommandGroup>
                {OPERATORS.map((op) => (
                  <CommandItem
                    key={op.value}
                    data-checked={filter.operator === op.value}
                    onSelect={() => handleOperatorChange(op.value)}
                  >
                    {op.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <span className="w-px h-3 bg-border/60" />

      {/* Value segment — clickable, shows icon+label or count */}
      <Popover open={valueOpen} onOpenChange={setValueOpen}>
        <PopoverTrigger className="flex items-center px-1.5 h-full text-foreground hover:text-foreground/80 transition-colors outline-none max-w-40">
          {valueDisplay}
        </PopoverTrigger>
        <PopoverContent className="w-44 p-0" align="start" sideOffset={6}>
          <FilterValueSelector options={fieldConfig.options} selected={filter.values} onToggle={handleValueToggle} />
        </PopoverContent>
      </Popover>

      {/* Remove × */}
      <button
        type="button"
        onClick={onRemove}
        className="flex items-center justify-center w-5 h-full text-muted-foreground hover:text-foreground transition-colors"
      >
        <RiCloseLine className="size-3" />
      </button>
    </div>
  )
}
