import { PresetCard, type PresetCardData } from './preset-card'

interface PresetPickerProps {
  presets: PresetCardData[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

/**
 * Grid of preset cards. Layout is responsive: 2 cols on narrow, 3 cols wider.
 */
export function PresetPicker({ presets, selectedKey, onSelect }: PresetPickerProps) {
  return (
    <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-3">
      {presets.map((preset) => (
        <PresetCard key={preset.key} preset={preset} selected={selectedKey === preset.key} onSelect={onSelect} />
      ))}
    </div>
  )
}
