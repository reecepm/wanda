import type { ViewConfig } from '../view/types'

/**
 * Built-in onboarding preset templates. Each preset is shown in the onboarding
 * template picker as a card with a mini-UI mockup. When a user selects one,
 * a real template pod is created with the matching view type + starter config.
 *
 * To add a new preset: append an entry to ONBOARDING_PRESETS and mirror the key
 * in src/features/onboarding/presets.ts. The key is a stable string identifier.
 */
interface OnboardingPreset {
  /**
   * Explicit sort order. Lower numbers appear first. Use integers with gaps
   * (10, 20, 30…) so new presets can be inserted between existing ones
   * without renumbering everything.
   */
  order: number
  /** Stable identifier. Must match the frontend mirror in src/features/onboarding/presets.ts. */
  key: string
  /** Display name for the template (used as the template pod name). */
  name: string
  /** Short marketing line (shown on the card). */
  tagline: string
  /** Longer description (shown on hover / selected state). */
  description: string
  /** View type the template's default view will use. */
  viewType: ViewConfig['type']
  /** Starter config for the default view. */
  defaultConfig: ViewConfig
}

/**
 * Built-in preset definitions. The display order is governed by the `order`
 * field, not by array position — callers must sort by `order` before
 * rendering. This avoids accidental reordering when adding/editing presets.
 */
const PRESETS: OnboardingPreset[] = [
  {
    order: 10,
    key: 'carousel',
    name: 'Carousel',
    tagline: 'Swipe through items.',
    description: 'A horizontally scrollable strip. Useful for sequentially reviewing related processes.',
    viewType: 'carousel',
    defaultConfig: { type: 'carousel', items: [] },
  },
  {
    order: 20,
    key: 'canvas',
    name: 'Canvas',
    tagline: 'Free-form, pan and zoom.',
    description:
      'Place terminals anywhere on an infinite 2D canvas. Organic layouts, mind-mapping vibes. Best for power users.',
    viewType: 'canvas',
    defaultConfig: { type: 'canvas', nodes: [], viewport: { x: 0, y: 0, zoom: 1 } },
  },
  {
    order: 30,
    key: 'tabs',
    name: 'Tabs',
    tagline: 'Simple. Like browser tabs.',
    description: 'Each terminal is a tab. Click to switch, one visible at a time. The simplest place to start.',
    viewType: 'tabs',
    defaultConfig: { type: 'tabs' },
  },
  {
    order: 40,
    key: 'split-pane',
    name: 'Split Pane',
    tagline: 'Resizable side-by-side panes.',
    description:
      'Divide the workspace into horizontal or vertical panes. Drag the dividers to resize. Great for watching a server log next to a dev server.',
    viewType: 'split-pane',
    // An empty layout — populated as items are added.
    defaultConfig: {
      type: 'split-pane',
      layout: { type: 'leaf', itemId: '' },
    },
  },
  {
    order: 50,
    key: 'grid',
    name: 'Grid',
    tagline: 'Dashboard-style widgets.',
    description:
      'Drag and drop terminals into a grid of widgets. Resize freely. Perfect when you want to see many things at once.',
    viewType: 'grid',
    defaultConfig: { type: 'grid', widgets: [], columns: 12, rowHeight: 80 },
  },
  {
    order: 60,
    key: 'columns',
    name: 'Columns',
    tagline: 'Rows of columns.',
    description: 'Group terminals into rows, with multiple columns per row. A flexible layout that scales vertically.',
    viewType: 'columns',
    defaultConfig: { type: 'columns', rows: [{ items: [] }] },
  },
]

/** Presets pre-sorted by `order`. This is what the router/UI should consume. */
export const ONBOARDING_PRESETS: OnboardingPreset[] = [...PRESETS].sort((a, b) => a.order - b.order)

export function getPresetByKey(key: string): OnboardingPreset | undefined {
  return ONBOARDING_PRESETS.find((p) => p.key === key)
}
