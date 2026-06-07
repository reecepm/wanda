import type { ViewType } from '@/features/view/utils/view-strategies'

export type ViewScope = 'pod' | 'workspace'

export interface ViewScopeConfig {
  scope: ViewScope
  allowedViewTypes: ViewType[]
  defaultViewType: ViewType
  itemCreation: {
    /** Whether user must select a pod when creating items */
    requiresPodSelection: boolean
  }
  visual: {
    /** Show pod color coding on items */
    showPodColorCoding: boolean
  }
}

export const VIEW_SCOPE_CONFIGS: Record<ViewScope, ViewScopeConfig> = {
  pod: {
    scope: 'pod',
    allowedViewTypes: ['tabs', 'split-pane', 'grid', 'carousel', 'canvas'],
    defaultViewType: 'split-pane',
    itemCreation: { requiresPodSelection: false },
    visual: { showPodColorCoding: false },
  },
  workspace: {
    scope: 'workspace',
    allowedViewTypes: ['canvas', 'columns'],
    defaultViewType: 'columns',
    itemCreation: { requiresPodSelection: true },
    visual: { showPodColorCoding: true },
  },
}
