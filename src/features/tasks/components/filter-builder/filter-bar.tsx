import { useMemo, useState } from 'react'
import { RiAddLine } from '@/lib/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { ActiveFilterPill } from './active-filter-pill'
import { buildProjectField, STATIC_FIELDS } from './filter-config'
import { FilterFieldSelector } from './filter-field-selector'
import type { ActiveFilter, FilterFieldConfig } from './types'

interface FilterBarProps {
  filters: ActiveFilter[]
  onChange: (filters: ActiveFilter[]) => void
  onSave?: () => void
  onToggleValue: (field: FilterFieldConfig, value: string) => void
  projects?: { id: string; name: string; identifier: string }[]
}

export function FilterBar({ filters, onChange, onSave, onToggleValue, projects }: FilterBarProps) {
  const [addOpen, setAddOpen] = useState(false)

  const allFields = useMemo<FilterFieldConfig[]>(() => {
    return [...STATIC_FIELDS, buildProjectField(projects ?? [])]
  }, [projects])

  const fieldConfigMap = useMemo(() => {
    const map = new Map<string, FilterFieldConfig>()
    for (const f of allFields) map.set(f.field, f)
    return map
  }, [allFields])

  function handleFilterChange(updated: ActiveFilter) {
    onChange(filters.map((f) => (f.id === updated.id ? updated : f)))
  }

  function handleFilterRemove(id: string) {
    onChange(filters.filter((f) => f.id !== id))
  }

  if (filters.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/40">
      {/* Active filter pills */}
      {filters.map((filter) => {
        const cfg = fieldConfigMap.get(filter.field)
        if (!cfg) return null
        return (
          <div key={filter.id} className="shrink-0">
            <ActiveFilterPill
              filter={filter}
              fieldConfig={cfg}
              onChange={handleFilterChange}
              onRemove={() => handleFilterRemove(filter.id)}
            />
          </div>
        )
      })}

      {/* + button */}
      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger className="flex items-center justify-center size-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 outline-none">
          <RiAddLine className="size-4" />
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start" sideOffset={6}>
          <FilterFieldSelector fields={allFields} activeFilters={filters} onToggleValue={onToggleValue} />
        </PopoverContent>
      </Popover>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear & Save */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear
        </button>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Save
          </button>
        )}
      </div>
    </div>
  )
}

export { priorityLabels, STATIC_FIELDS } from './filter-config'
