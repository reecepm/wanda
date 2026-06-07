import type { PerViewState } from '@/features/view/utils/view-strategies'
import { orpcForPod, orpcUtils } from '@/shared/orpc'
import type { ViewConfig, ViewItemSettings } from '@/types/schema'
import { getStrategy } from './helpers'
import type { DBView } from './view-store'

export type PersistenceScope = 'pod' | 'workspace'

export interface PersistenceStrategy {
  readonly scope: PersistenceScope
  // `entityId` is the pod id (possibly namespaced `remote:<regId>:<uuid>`)
  // for pod persistence, and the workspace id for workspace persistence.
  // Pod persistence uses it to resolve the RIGHT server — for remote
  // pods, writes route to the paired RPC client so window layout /
  // view updates actually reach the server that owns the pod.
  persistView(entityId: string, view: PerViewState): void
  createView(
    entityId: string,
    name: string,
    viewType: string,
    config: ViewConfig | null,
    itemSettings: Record<string, ViewItemSettings>,
  ): Promise<DBView>
  deleteView(entityId: string, id: string): Promise<void>
  setActiveView(entityId: string, viewId: string | null): Promise<void>
}

function buildViewConfig(view: PerViewState): ViewConfig | null {
  const strategy = getStrategy(view)
  const raw = strategy.buildConfig(view)
  if (!raw || !('type' in raw)) return null
  return raw as ViewConfig
}

function buildPersistPayload(view: PerViewState | undefined | null): {
  itemSettings: Record<string, ViewItemSettings>
  config: ViewConfig | null
} {
  // Defensive: the closure captured by `debouncedPersist` has been seen
  // firing with a view that the Zustand state has since replaced. We
  // also get called through `_persistAllViews` where nothing screens
  // out an undefined entry. Returning an empty payload is safe —
  // whatever mutation triggered the persist will have scheduled its
  // own fresh persist next tick with a live view.
  if (!view || !view.itemSettings) {
    return { itemSettings: {}, config: null }
  }
  const itemSettings: Record<string, ViewItemSettings> = {}
  for (const [key, val] of Object.entries(view.itemSettings)) {
    if (!val) continue
    itemSettings[key] = { sortOrder: val.sortOrder, ...(val.pinned ? { pinned: true } : {}) }
  }
  const config = buildViewConfig(view)
  const configWithFocus: ViewConfig | null = config
    ? ({ ...config, focusedItemId: view.focusedItemId ?? undefined } as ViewConfig)
    : null
  return { itemSettings, config: configWithFocus }
}

/** Extract the server-side pod uuid from a namespaced one. */
function unwrapId(entityId: string): string {
  if (entityId.startsWith('remote:')) {
    const rest = entityId.slice('remote:'.length)
    const sep = rest.indexOf(':')
    if (sep > 0) return rest.slice(sep + 1)
  }
  return entityId
}

export const podPersistence: PersistenceStrategy = {
  scope: 'pod',

  persistView(entityId, view) {
    if (!view || !view.id) return
    const client = orpcForPod(entityId)
    const { itemSettings, config } = buildPersistPayload(view)
    client.view
      .update({ id: view.id, name: view.name, itemSettings, ...(config ? { config } : {}) })
      .catch((err) => console.error('[view-store] persist failed:', err))
  },

  async createView(entityId, name, viewType, config, itemSettings) {
    const client = orpcForPod(entityId)
    const created = await client.view.create({
      podId: unwrapId(entityId),
      name,
      viewType,
      config: (config ?? { type: 'tabs' }) as ViewConfig,
      itemSettings,
    })
    return {
      id: created.id,
      name: created.name,
      viewType: created.viewType,
      config: created.config,
      itemSettings: (created.itemSettings ?? {}) as Record<string, ViewItemSettings>,
    }
  },

  async deleteView(entityId, id) {
    await orpcForPod(entityId).view.delete({ id })
  },

  async setActiveView(entityId, viewId) {
    if (viewId) await orpcForPod(entityId).pod.setActiveView({ podId: unwrapId(entityId), viewId })
  },
}

// Workspace views are LOCAL-only — paired workspaces don't have
// a per-client view layout on the remote. Keep using the local client.

export const workspacePersistence: PersistenceStrategy = {
  scope: 'workspace',

  persistView(_entityId, view) {
    if (!view || !view.id) return
    const { itemSettings, config } = buildPersistPayload(view)
    orpcUtils.workspaceView.update
      .call({
        id: view.id,
        name: view.name,
        itemSettings,
        ...(config ? { config } : {}),
      })
      .catch((err) => console.error('[view-store] workspace persist failed:', err))
  },

  async createView(entityId, name, viewType, config, itemSettings) {
    const created = await orpcUtils.workspaceView.create.call({
      workspaceId: entityId,
      name,
      viewType,
      config: (config ?? { type: 'columns', rows: [] }) as ViewConfig,
      itemSettings,
    })
    return {
      id: created.id,
      name: created.name,
      viewType: created.viewType,
      config: created.config,
      itemSettings: (created.itemSettings ?? {}) as Record<string, ViewItemSettings>,
    }
  },

  async deleteView(_entityId, id) {
    await orpcUtils.workspaceView.delete.call({ id })
  },

  async setActiveView(entityId, viewId) {
    await orpcUtils.workspaceView.setActiveView.call({ workspaceId: entityId, viewId })
  },
}

let _debouncedTimer: ReturnType<typeof setTimeout> | null = null
let _debouncedPending: (() => void) | null = null

export function debouncedPersist(strategy: PersistenceStrategy, entityId: string, view: PerViewState) {
  if (!view) return
  if (_debouncedTimer) clearTimeout(_debouncedTimer)
  _debouncedPending = () => strategy.persistView(entityId, view)
  _debouncedTimer = setTimeout(() => {
    _debouncedPending?.()
    _debouncedPending = null
    _debouncedTimer = null
  }, 300)
}

export function flushDebouncedPersist() {
  if (_debouncedTimer) {
    clearTimeout(_debouncedTimer)
    _debouncedTimer = null
  }
  if (_debouncedPending) {
    _debouncedPending()
    _debouncedPending = null
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushDebouncedPersist)
}
