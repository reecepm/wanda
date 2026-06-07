import { motion } from 'motion/react'
import { cn } from '@/shared/utils'
import { getPresetUI } from '../presets'

export interface PresetCardData {
  key: string
  name: string
  tagline: string
}

interface PresetCardProps {
  preset: PresetCardData
  selected: boolean
  onSelect: (key: string) => void
}

/**
 * One card in the template picker grid. Renders the matching mockup for the
 * preset key plus a label/tagline below. Click selects — the parent component
 * owns selection state.
 */
export function PresetCard({ preset, selected, onSelect }: PresetCardProps) {
  const ui = getPresetUI(preset.key)
  if (!ui) return null
  const Mockup = ui.Mockup

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(preset.key)}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'group flex w-full flex-col gap-2 rounded-lg border bg-zinc-900/40 p-3 text-left outline-none transition-colors',
        selected
          ? 'border-amber-500/60 bg-zinc-900/80 ring-1 ring-amber-500/30'
          : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60',
      )}
    >
      <Mockup active={selected} />
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-200">{preset.name}</span>
          {selected && (
            <motion.span
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-[10px] font-medium text-amber-400"
            >
              Selected
            </motion.span>
          )}
        </div>
        <span className="text-[10px] text-zinc-500 leading-snug">{preset.tagline}</span>
      </div>
    </motion.button>
  )
}
