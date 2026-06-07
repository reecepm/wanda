import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { onOrpcInvalidate, orpcUtils } from '@/shared/orpc'

/**
 * Listens for MCP-originated mutations (via HTTP oRPC) and invalidates
 * the corresponding TanStack Query namespace so the UI updates immediately.
 */
export function useMcpInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const cleanup = onOrpcInvalidate((namespace) => {
      const nsUtils = orpcUtils[namespace as keyof typeof orpcUtils]
      if (nsUtils && 'key' in nsUtils && typeof (nsUtils as { key: unknown }).key === 'function') {
        const key = (nsUtils as { key: () => readonly unknown[] }).key()
        queryClient.invalidateQueries({ queryKey: key })
      }
    })
    return () => {
      cleanup()
    }
  }, [queryClient])
}
