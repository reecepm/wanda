// -----------------------------------------------------------------------------
// Renderer-side E2E hooks (gated by the `__wandaTestHooks` sentinel the
// preload installs in test mode). Playwright calls these via
// `page.evaluate` to inspect app state that's otherwise hidden behind
// React trees + TanStack Query cache + Zustand stores. Production bundles
// skip this module entirely — call sites should dynamic-import it.
// -----------------------------------------------------------------------------

import type { QueryClient } from '@tanstack/react-query'
import { terminalRegistry } from './features/terminal/terminal-registry'

export interface TestHookRegistry {
  getPairedQueryCacheEntries(registryId: string): Array<{
    queryKey: readonly unknown[]
    state: { status: string; dataUpdateCount: number; fetchStatus: string }
  }>
  readTerminalText(ptyInstanceId: string): string
  listMountedTerminals(): string[]
  openProductionPairedBridge(registryId: string): Promise<void>
  getRecordedInvalidates(registryId: string): Array<{ namespace: string; method: string }>
  closeProductionPairedBridge(registryId: string): Promise<void>
  getViewStoreSnapshot(entityId: string): Promise<{
    activeViewId: string | null
    podItemIds: string[]
    viewItemSettings: Record<string, string[]>
  } | null>
}

export function installTestHooks(queryClient: QueryClient): void {
  if (typeof (window as unknown as { __wandaTestHooks?: unknown }).__wandaTestHooks === 'undefined') {
    return
  }

  const bridgeInvalidates = new Map<string, Array<{ namespace: string; method: string }>>()
  const bridgeDisposers = new Map<string, () => void>()

  const getViewStore = async () => {
    const { useViewStore } = await import('./features/view/store/view-store')
    return useViewStore
  }

  const registry: TestHookRegistry = {
    getPairedQueryCacheEntries(registryId) {
      const cache = queryClient.getQueryCache()
      return cache
        .getAll()
        .filter((q) => {
          const k = q.queryKey as readonly unknown[]
          return k[0] === 'remote' && k[1] === registryId
        })
        .map((q) => ({
          queryKey: q.queryKey as readonly unknown[],
          state: {
            status: q.state.status,
            dataUpdateCount: q.state.dataUpdateCount,
            fetchStatus: q.state.fetchStatus,
          },
        }))
    },

    readTerminalText(ptyInstanceId) {
      const managed = terminalRegistry.instances.get(ptyInstanceId)
      if (!managed) return ''
      const buf = managed.terminal.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        const line = buf.getLine(i)
        if (line) lines.push(line.translateToString(true))
      }
      return lines.join('\n')
    },

    listMountedTerminals() {
      return Array.from(terminalRegistry.instances.keys())
    },

    async openProductionPairedBridge(registryId) {
      const { getPairedTerminalBridge } = await import('./features/servers')
      const bridge = await getPairedTerminalBridge(registryId)
      if (!bridgeInvalidates.has(registryId)) bridgeInvalidates.set(registryId, [])
      const seen = bridgeInvalidates.get(registryId)!
      const off = bridge.onInvalidate((namespace, method) => {
        seen.push({ namespace, method })
      })
      const existing = bridgeDisposers.get(registryId)
      if (existing) existing()
      bridgeDisposers.set(registryId, off)
    },

    getRecordedInvalidates(registryId) {
      return bridgeInvalidates.get(registryId) ?? []
    },

    async closeProductionPairedBridge(registryId) {
      const { disposePairedTerminalBridge } = await import('./features/servers')
      const off = bridgeDisposers.get(registryId)
      if (off) off()
      bridgeDisposers.delete(registryId)
      bridgeInvalidates.delete(registryId)
      disposePairedTerminalBridge(registryId)
    },

    async getViewStoreSnapshot(entityId) {
      const useViewStore = await getViewStore()
      const state = useViewStore.getState()
      const p = state.entities[entityId]
      if (!p) return null
      const viewItemSettings: Record<string, string[]> = {}
      for (const v of p.views) {
        viewItemSettings[v.id] = v.itemSettings ? Object.keys(v.itemSettings) : []
      }
      return {
        activeViewId: p.activeViewId,
        podItemIds: p.podItems.map((pi) => pi.id),
        viewItemSettings,
      }
    },
  }

  ;(window as unknown as { __wandaTestRenderer: TestHookRegistry }).__wandaTestRenderer = registry
}
