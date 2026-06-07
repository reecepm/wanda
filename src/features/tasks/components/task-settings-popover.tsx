import { useState } from 'react'
import { RiSettings4Line } from '@/lib/icons'
import type { TaskViewConfig } from '@/types/schema'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover'
import { Switch } from '@/ui/switch'

const GROUP_OPTIONS: { value: TaskViewConfig['groupBy']; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority' },
  { value: 'type', label: 'Type' },
  { value: 'project', label: 'Project' },
  { value: 'none', label: 'No grouping' },
]

const SORT_OPTIONS: { value: TaskViewConfig['sortBy']; label: string }[] = [
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'status', label: 'Status' },
]

const DISPLAY_FIELDS: { value: TaskViewConfig['fields'][number]; label: string }[] = [
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priority' },
  { value: 'labels', label: 'Labels' },
  { value: 'project', label: 'Project' },
  { value: 'created', label: 'Created' },
]

interface TaskSettingsPopoverProps {
  config: TaskViewConfig
  onConfigChange: (config: TaskViewConfig) => void
}

export function TaskSettingsPopover({ config, onConfigChange }: TaskSettingsPopoverProps) {
  const [open, setOpen] = useState(false)

  function toggleField(field: TaskViewConfig['fields'][number]) {
    const fields = config.fields.includes(field) ? config.fields.filter((f) => f !== field) : [...config.fields, field]
    onConfigChange({ ...config, fields })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="flex items-center gap-1 p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors outline-none"
        title="View settings"
      >
        <RiSettings4Line className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0">
        <div className="p-3 space-y-4">
          {/* Layout toggle */}
          <div className="flex items-center rounded-md bg-zinc-800 p-0.5">
            <button
              type="button"
              onClick={() => onConfigChange({ ...config, layout: 'grouped-list' })}
              className={`flex-1 text-[11px] py-1 rounded-md transition-colors ${
                config.layout === 'grouped-list' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => onConfigChange({ ...config, layout: 'board' })}
              className={`flex-1 text-[11px] py-1 rounded-md transition-colors ${
                config.layout === 'board' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Board
            </button>
          </div>

          {/* Grouping */}
          <SettingRow label="Grouping">
            <select
              value={config.groupBy}
              onChange={(e) => onConfigChange({ ...config, groupBy: e.target.value as TaskViewConfig['groupBy'] })}
              className="h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 outline-none"
            >
              {GROUP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingRow>

          {/* Ordering */}
          <SettingRow label="Ordering">
            <select
              value={config.sortBy}
              onChange={(e) => onConfigChange({ ...config, sortBy: e.target.value as TaskViewConfig['sortBy'] })}
              className="h-6 rounded-md border border-zinc-700 bg-zinc-800 px-1.5 text-[11px] text-zinc-200 outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <div className="h-px bg-zinc-800" />

          {/* Show completed */}
          <SettingRow label="Completed tasks">
            <Switch
              size="sm"
              checked={config.showCompletedTasks}
              onCheckedChange={(checked) => onConfigChange({ ...config, showCompletedTasks: checked })}
            />
          </SettingRow>

          <div className="h-px bg-zinc-800" />

          {/* Display properties */}
          <div>
            <span className="text-[10px] text-zinc-500 font-medium">Display properties</span>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {DISPLAY_FIELDS.map((f) => {
                const active = config.fields.includes(f.value)
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => toggleField(f.value)}
                    className={`px-2 py-0.5 rounded-md text-[10px] transition-colors border ${
                      active
                        ? 'bg-zinc-700 text-zinc-200 border-zinc-600'
                        : 'text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-zinc-400">{label}</span>
      {children}
    </div>
  )
}
