import type { ComponentType } from 'react'
import { CanvasMockup } from './components/mockups/canvas-mockup'
import { CarouselMockup } from './components/mockups/carousel-mockup'
import { ColumnsMockup } from './components/mockups/columns-mockup'
import { GridMockup } from './components/mockups/grid-mockup'
import { SplitPaneMockup } from './components/mockups/split-pane-mockup'
import { TabsMockup } from './components/mockups/tabs-mockup'

/**
 * UI-side mirror of ONBOARDING_PRESETS in electron/domains/onboarding/presets.ts.
 * Keys here must match the backend. The backend is the source of truth for
 * view config defaults — this file only supplies the card visuals.
 *
 * To add a new preset: add a backend entry, then append here with a matching key
 * and a mockup component. The card grid and store pick it up automatically.
 */
export interface OnboardingPresetUI {
  key: string
  Mockup: ComponentType<{ className?: string; active?: boolean }>
}

export const ONBOARDING_PRESETS_UI: OnboardingPresetUI[] = [
  { key: 'tabs', Mockup: TabsMockup },
  { key: 'split-pane', Mockup: SplitPaneMockup },
  { key: 'grid', Mockup: GridMockup },
  { key: 'columns', Mockup: ColumnsMockup },
  { key: 'carousel', Mockup: CarouselMockup },
  { key: 'canvas', Mockup: CanvasMockup },
]

export function getPresetUI(key: string): OnboardingPresetUI | undefined {
  return ONBOARDING_PRESETS_UI.find((p) => p.key === key)
}
