import type { Project } from '@wanda/tasks'
import { useCallback, useMemo } from 'react'
import { ContentTopBar } from '@/layout/content-top-bar'
import { RiAddLine, RiFilterLine } from '@/lib/icons'
import type { TaskFilterConfig, TaskViewConfig } from '@/types/schema'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import type { ActiveFilter } from './filter-builder'
import { FilterBar } from './filter-builder'
import { buildProjectField, STATIC_FIELDS } from './filter-builder/filter-config'
import { FilterFieldSelector } from './filter-builder/filter-field-selector'
import type { FilterFieldConfig } from './filter-builder/types'
import { TaskSettingsPopover } from './task-settings-popover'
import { TaskViewTabStrip } from './task-view-tab-strip'

// ---------------------------------------------------------------------------
// Convert between TaskFilterConfig (persisted) ↔ ActiveFilter[] (UI)
// ---------------------------------------------------------------------------

let _id = 0
function uid() {
  return `af-${++_id}`
}

function configToFilters(cfg: TaskFilterConfig): ActiveFilter[] {
  const filters: ActiveFilter[] = []

  if (cfg.statuses?.length) {
    filters.push({
      id: uid(),
      field: 'status',
      operator: cfg.statuses.length === 1 ? 'is' : 'is any of',
      values: cfg.statuses,
    })
  }
  if (cfg.types?.length) {
    filters.push({
      id: uid(),
      field: 'type',
      operator: cfg.types.length === 1 ? 'is' : 'is any of',
      values: cfg.types,
    })
  }
  if (cfg.priorities?.length) {
    filters.push({
      id: uid(),
      field: 'priority',
      operator: cfg.priorities.length === 1 ? 'is' : 'is any of',
      values: cfg.priorities.map(String),
    })
  }
  if (cfg.projectIds?.length) {
    filters.push({
      id: uid(),
      field: 'project',
      operator: cfg.projectIds.length === 1 ? 'is' : 'is any of',
      values: cfg.projectIds,
    })
  }

  return filters
}

function filtersToConfig(filters: ActiveFilter[]): TaskFilterConfig {
  const cfg: TaskFilterConfig = {}

  for (const f of filters) {
    if (f.values.length === 0) continue
    switch (f.field) {
      case 'status':
        cfg.statuses = [...(cfg.statuses ?? []), ...f.values]
        break
      case 'type':
        cfg.types = [...(cfg.types ?? []), ...f.values]
        break
      case 'priority':
        cfg.priorities = [...(cfg.priorities ?? []), ...f.values.map(Number)]
        break
      case 'project':
        cfg.projectIds = [...(cfg.projectIds ?? []), ...f.values]
        break
    }
  }

  return cfg
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

interface TaskViewToolbarProps {
  views: { id: string; name: string; config: TaskViewConfig; sortOrder: number }[]
  config: TaskViewConfig
  onConfigChange: (config: TaskViewConfig) => void
  projects: Project[]
  onCreateTask: () => void
}

export function TaskViewToolbar({ views, config, onConfigChange, projects, onCreateTask }: TaskViewToolbarProps) {
  const activeFilters = useMemo(() => configToFilters(config.filters), [config.filters])

  const allFields = useMemo(() => {
    return [...STATIC_FIELDS, buildProjectField(projects)]
  }, [projects])

  const handleFiltersChange = useCallback(
    (filters: ActiveFilter[]) => {
      onConfigChange({ ...config, filters: filtersToConfig(filters) })
    },
    [config, onConfigChange],
  )

  const handleToggleValue = useCallback(
    (fieldConfig: FilterFieldConfig, value: string) => {
      const existing = activeFilters.find((f) => f.field === fieldConfig.field)
      let updated: ActiveFilter[]

      if (existing) {
        const hasValue = existing.values.includes(value)
        const newValues = hasValue ? existing.values.filter((v) => v !== value) : [...existing.values, value]

        if (newValues.length === 0) {
          // Remove the filter entirely
          updated = activeFilters.filter((f) => f.id !== existing.id)
        } else {
          updated = activeFilters.map((f) =>
            f.id === existing.id
              ? {
                  ...f,
                  values: newValues,
                  operator: newValues.length === 1 ? 'is' : 'is any of',
                }
              : f,
          )
        }
      } else {
        // Create new filter with this value
        updated = [
          ...activeFilters,
          {
            id: uid(),
            field: fieldConfig.field,
            operator: 'is',
            values: [value],
          },
        ]
      }

      handleFiltersChange(updated)
    },
    [activeFilters, handleFiltersChange],
  )

  return (
    <>
      <ContentTopBar>
        <ContentTopBar.Left>
          <TaskViewTabStrip views={views} />
        </ContentTopBar.Left>
        <ContentTopBar.Right>
          {/* Filter add button — opens field selector when no filters active */}
          <Popover>
            <PopoverTrigger className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground transition-colors outline-none">
              <RiFilterLine className="size-3.5" />
              Filter
            </PopoverTrigger>
            <PopoverContent className="w-48 p-0" align="end" sideOffset={6}>
              <FilterFieldSelector fields={allFields} activeFilters={activeFilters} onToggleValue={handleToggleValue} />
            </PopoverContent>
          </Popover>

          <TaskSettingsPopover config={config} onConfigChange={onConfigChange} />

          <button
            type="button"
            onClick={onCreateTask}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-zinc-300 bg-zinc-700 hover:bg-zinc-600 transition-colors"
          >
            <RiAddLine className="size-3" />
            New Task
          </button>
        </ContentTopBar.Right>
      </ContentTopBar>

      {/* Filter bar — only shows when filters are active */}
      <FilterBar
        filters={activeFilters}
        onChange={handleFiltersChange}
        onToggleValue={handleToggleValue}
        projects={projects}
      />
    </>
  )
}
