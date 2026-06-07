import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'

/**
 * Mutations for workenv lifecycle. Each mutation invalidates `workenv.list`
 * + the specific workenv on success so the UI reflects the new state
 * without a refetch round-trip — the WS broadcast also fires the same
 * invalidation; the duplicate is harmless and protects against races.
 */
export function useWorkenvActions() {
  const qc = useQueryClient()
  const invalidate = (id?: string) => {
    void qc.invalidateQueries({ queryKey: orpcUtils.workenv.list.queryKey() })
    if (id) {
      void qc.invalidateQueries({
        queryKey: orpcUtils.workenv.getById.queryKey({ input: { id } }),
      })
    }
  }

  const start = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.start.call({ id }),
    onSuccess: (_data, id) => invalidate(id),
  })
  const stop = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.stop.call({ id }),
    onSuccess: (_data, id) => invalidate(id),
  })
  const restart = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.restart.call({ id }),
    onSuccess: (_data, id) => invalidate(id),
  })
  const destroy = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.destroy.call>[0]) => orpcUtils.workenv.destroy.call(input),
    onSuccess: () => invalidate(),
  })
  const create = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.create.call>[0]) => orpcUtils.workenv.create.call(input),
    onSuccess: () => invalidate(),
  })
  const update = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.update.call>[0]) => orpcUtils.workenv.update.call(input),
    onSuccess: (_data, { id }) => invalidate(id),
  })

  return { start, stop, restart, destroy, create, update }
}
