import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AgentStatusInfo as AgentStatusEventInfo,
  onAgentPermissionRequest,
  onAgentStatusChange,
} from '@/features/agent'
import { orpcUtils } from '@/shared/orpc'

export type AgentStatusInfo = AgentStatusEventInfo

/**
 * Subscribes to real-time agent status updates via IPC and fetches
 * the initial snapshot from the server. Returns a lookup function.
 */
export function useAgentStatuses() {
  const [statusMap, setStatusMap] = useState<Map<string, AgentStatusInfo>>(new Map())

  useEffect(() => {
    orpcUtils.agent.getStatuses
      .call({})
      .then((entries) => {
        if (!entries?.length) return
        setStatusMap((prev) => {
          const next = new Map(prev)
          for (const e of entries) {
            next.set(e.podTerminalId, {
              status: e.status,
              agentType: e.agentType,
              sessionId: e.sessionId,
              errorDetail: e.errorDetail,
              exitCode: e.exitCode,
              exitOutput: e.exitOutput,
            })
          }
          return next
        })
      })
      .catch(() => {
        /* best-effort */
      })
  }, [])

  useEffect(() => {
    const unsubscribe = onAgentStatusChange((terminalId, status) => {
      setStatusMap((prev) => {
        const next = new Map(prev)
        next.set(terminalId, status)
        return next
      })
    })
    return () => {
      unsubscribe()
    }
  }, [])

  const getStatus = useCallback(
    (podTerminalId: string): AgentStatusInfo | undefined => {
      return statusMap.get(podTerminalId)
    },
    [statusMap],
  )

  return { statusMap, getStatus }
}

export function useAgentPermissionRequests(onPermissionRequest: () => void) {
  const onPermissionRequestRef = useRef(onPermissionRequest)

  useEffect(() => {
    onPermissionRequestRef.current = onPermissionRequest
  }, [onPermissionRequest])

  useEffect(() => {
    const unsubscribe = onAgentPermissionRequest(() => {
      onPermissionRequestRef.current()
    })
    return () => {
      unsubscribe()
    }
  }, [])
}
