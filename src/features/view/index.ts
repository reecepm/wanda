export { ActiveViewRenderer } from './components/active-view-renderer'
export { ItemIcon, PodPill } from './components/item-chrome'
export { ItemPicker } from './components/item-picker'
// Types re-exported from tab-content (used by pod feature)
export type { CommandConfig, RunningCommand } from './components/tab-content'
export { ViewTabStrip } from './components/view-tab-strip'
export { WorkspaceTopBar } from './components/workspace-top-bar'
export { WorkspaceViewScreen } from './components/workspace-view-screen'

export { useItemPicker } from './hooks/use-item-picker'
export { usePodColor } from './hooks/use-pod-color'
export { useWorkspaceViewData, type WorkspaceViewData } from './hooks/use-workspace-view-data'
export { useWorkspaceViewLifecycle } from './hooks/use-workspace-view-lifecycle'
export type { PodColor, PodMeta, ViewScope, ViewScopeConfig, ViewScopeContextValue } from './scope'
export { getPodColor, POD_COLORS, useViewScope, VIEW_SCOPE_CONFIGS, ViewScopeProvider } from './scope'
export type { PersistenceScope, PersistenceStrategy } from './store/persistence-strategy'
export { flushDebouncedPersist } from './store/persistence-strategy'
export { panToCanvasNode, useViewCallbacks } from './store/view-callbacks'
export type { DBView, PodItem, ScopeState, ViewItem } from './store/view-store'
export { useActiveView, usePodItem, useViewStore } from './store/view-store'
export type { AgentMenuConfig, ItemMenuItemId } from './utils/item-menu-order'
export {
  AGENT_MENU_CONFIG_SETTING_KEY,
  applyAgentMenuConfig,
  completeAgentMenuOrder,
  completeItemMenuOrder,
  DEFAULT_ITEM_MENU_ORDER,
  ITEM_MENU_LABELS,
  ITEM_MENU_ORDER_SETTING_KEY,
  orderItemMenuEntries,
  parseAgentMenuConfig,
  parseItemMenuOrder,
  serializeAgentMenuConfig,
  serializeItemMenuOrder,
} from './utils/item-menu-order'
