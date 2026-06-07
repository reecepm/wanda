import { useEffect, useState } from 'react'
import {
  listActivePairedBridges,
  onPairedBridgeCacheChange,
  type PairedConnectionStatus,
} from './paired-terminal-bridge'

export interface PairedStatusEntry {
  registryId: string
  status: PairedConnectionStatus
}

/**
 * Subscribe to the live ClientConnection state of every active paired
 * bridge. "Active" == the user opened a paired pod at some point, which
 * lazily constructed the bridge. The returned list excludes bridges
 * still in `idle` (not yet started) so the connection-status indicator
 * doesn't warn about paired servers that were never used.
 */
export function useActivePairedStatuses(): PairedStatusEntry[] {
  const [entries, setEntries] = useState<PairedStatusEntry[]>([])

  useEffect(() => {
    const perBridgeUnsub = new Map<string, () => void>()
    const current = new Map<string, PairedConnectionStatus>()

    function emit() {
      const next: PairedStatusEntry[] = []
      for (const [registryId, status] of current) {
        if (status === 'idle') continue
        next.push({ registryId, status })
      }
      setEntries(next)
    }

    function attach(registryId: string, bridge: ReturnType<typeof listActivePairedBridges>[number]['bridge']): void {
      if (perBridgeUnsub.has(registryId)) return
      const off = bridge.onStatus((status) => {
        current.set(registryId, status)
        emit()
      })
      perBridgeUnsub.set(registryId, off)
    }

    function syncFromCache() {
      const seen = new Set<string>()
      for (const { registryId, bridge } of listActivePairedBridges()) {
        seen.add(registryId)
        attach(registryId, bridge)
      }
      for (const [registryId, off] of perBridgeUnsub) {
        if (!seen.has(registryId)) {
          off()
          perBridgeUnsub.delete(registryId)
          current.delete(registryId)
        }
      }
      emit()
    }

    syncFromCache()
    const offCache = onPairedBridgeCacheChange(syncFromCache)
    return () => {
      offCache()
      for (const off of perBridgeUnsub.values()) off()
      perBridgeUnsub.clear()
    }
  }, [])

  return entries
}
