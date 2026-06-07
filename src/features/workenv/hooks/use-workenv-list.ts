import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import {
  onWorkenvBootstrapProgress,
  onWorkenvCreated,
  onWorkenvDestroyed,
  onWorkenvEventAdded,
  onWorkenvHealth,
  onWorkenvPrebuildLog,
  onWorkenvPrebuildProgress,
  onWorkenvStateChanged,
  onWorkenvUpdated,
} from '@/shared/app-bridge'
import { orpcUtils } from '@/shared/orpc'

type ProgressStatus = 'started' | 'succeeded' | 'failed'
type BootstrapProgressHandler = (index: number, name: string, status: ProgressStatus) => void
type AnyBootstrapProgressHandler = (workenvId: string, index: number, name: string, status: ProgressStatus) => void
type HealthHandler = (healthy: boolean) => void
type PrebuildHandlers = {
  onLog: (hash: string, chunk: string) => void
  onProgress: (hash: string, index: number, name: string, status: ProgressStatus) => void
}

export function useWorkenvList() {
  const qc = useQueryClient()
  const query = useQuery(orpcUtils.workenv.list.queryOptions())

  // Live-invalidate on workenv.* broadcasts so the list reflects creates,
  // destroys, and state changes without a manual refetch.
  useEffect(() => {
    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: orpcUtils.workenv.list.queryKey() })
    }
    const offCreated = onWorkenvCreated(invalidate)
    const offUpdated = onWorkenvUpdated(invalidate)
    const offDestroyed = onWorkenvDestroyed(invalidate)
    const offState = onWorkenvStateChanged(invalidate)
    return () => {
      offCreated()
      offUpdated()
      offDestroyed()
      offState()
    }
  }, [qc])

  return query
}

export function useWorkenv(id: string | null | undefined) {
  const qc = useQueryClient()
  const query = useQuery({
    ...orpcUtils.workenv.getById.queryOptions({ input: { id: id ?? '' } }),
    enabled: !!id,
  })

  useEffect(() => {
    if (!id) return
    const invalidate = (changedId: string) => {
      if (changedId === id) {
        void qc.invalidateQueries({
          queryKey: orpcUtils.workenv.getById.queryKey({ input: { id } }),
        })
      }
    }
    const offUpdated = onWorkenvUpdated(invalidate)
    const offState = onWorkenvStateChanged(invalidate)
    const offHealth = onWorkenvHealth(invalidate)
    return () => {
      offUpdated()
      offState()
      offHealth()
    }
  }, [id, qc])

  return query
}

export function useWorkenvBootstrapProgress(workenvId: string, onProgress: BootstrapProgressHandler) {
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    const off = onWorkenvBootstrapProgress((id, index, name, status) => {
      if (id !== workenvId) return
      onProgressRef.current(index, name, status)
    })
    return off
  }, [workenvId])
}

export function useAnyWorkenvBootstrapProgress(onProgress: AnyBootstrapProgressHandler) {
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    const off = onWorkenvBootstrapProgress((id, index, name, status) => {
      onProgressRef.current(id, index, name, status)
    })
    return off
  }, [])
}

export function useWorkenvEventsInvalidation(workenvId: string, limit: number) {
  const qc = useQueryClient()

  useEffect(() => {
    const off = onWorkenvEventAdded((id) => {
      if (id === workenvId) {
        void qc.invalidateQueries({
          queryKey: orpcUtils.workenv.listEvents.queryKey({ input: { id: workenvId, limit } }),
        })
      }
    })
    return off
  }, [qc, workenvId, limit])
}

export function useWorkenvHealthSignal(workenvId: string, onHealth: HealthHandler) {
  const onHealthRef = useRef(onHealth)

  useEffect(() => {
    onHealthRef.current = onHealth
  }, [onHealth])

  useEffect(() => {
    const off = onWorkenvHealth((id, healthy) => {
      if (id === workenvId) onHealthRef.current(healthy)
    })
    return off
  }, [workenvId])
}

export function useWorkenvPrebuildSignals(templateId: string, handlers: PrebuildHandlers) {
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  }, [handlers])

  useEffect(() => {
    const offProgress = onWorkenvPrebuildProgress((id, hash, index, name, status) => {
      if (id !== templateId) return
      handlersRef.current.onProgress(hash, index, name, status)
    })
    const offLog = onWorkenvPrebuildLog((id, hash, chunk) => {
      if (id !== templateId) return
      handlersRef.current.onLog(hash, chunk)
    })
    return () => {
      offProgress()
      offLog()
    }
  }, [templateId])
}
