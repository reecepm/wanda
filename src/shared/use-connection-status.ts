import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { type ConnectionStatus, onConnectionStatus, onShellReconnect } from '@/shared/app-bridge'

/**
 * Tracks the live WebSocket connection status and auto-invalidates the
 * TanStack Query cache whenever the renderer reconnects or the server
 * subprocess restarts.
 */
export function useConnectionStatus(): ConnectionStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConnectionStatus>('connected')

  useEffect(() => {
    let previous: ConnectionStatus = 'connected'
    const unsubscribeStatus = onConnectionStatus((next) => {
      setStatus(next)
      if (next === 'connected' && (previous === 'reconnecting' || previous === 'disconnected')) {
        void queryClient.invalidateQueries()
      }
      previous = next
    })

    const unsubscribeRestart = onShellReconnect(() => {
      void queryClient.invalidateQueries()
    })

    return () => {
      unsubscribeStatus()
      unsubscribeRestart()
    }
  }, [queryClient])

  return status
}
