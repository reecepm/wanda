import { createContext, useContext } from 'react'
import { VIEW_SCOPE_CONFIGS, type ViewScope, type ViewScopeConfig } from './view-scope-config'

export interface PodMeta {
  id: string
  name: string
  status: string
  color: string
}

export interface ViewScopeContextValue {
  config: ViewScopeConfig
  scope: ViewScope
  /** The entity ID for this scope (podId or workspaceId) */
  entityId: string
  /** Available pods — populated at workspace scope for pod picker and color assignment */
  pods?: PodMeta[]
}

const ViewScopeContext = createContext<ViewScopeContextValue>({
  config: VIEW_SCOPE_CONFIGS.pod,
  scope: 'pod',
  entityId: '',
})

export const ViewScopeProvider = ViewScopeContext.Provider

export function useViewScope() {
  return useContext(ViewScopeContext)
}
