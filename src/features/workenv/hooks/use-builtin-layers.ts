// useBuiltinLayers — list the catalog of bundled layers, plus a derived
// `defaults` array for prefill in create flows.
//
// The `default: true` flag on a catalog entry means "preselect when the user
// is starting from scratch". Defaults stay small so a fresh workenv boots
// reliably; network-heavy runtimes stay opt-in.

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { orpcUtils } from '@/shared/orpc'
import type { WorkenvLayer } from '@/types/schema'

export function useBuiltinLayers() {
  return useQuery(orpcUtils.workenv.listBuiltinLayers.queryOptions())
}

export function useDefaultLayers(): WorkenvLayer[] {
  const { data } = useBuiltinLayers()
  return useMemo(() => (data ?? []).filter((e) => e.default).map((e) => e.layer), [data])
}
