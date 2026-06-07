import { useQuery } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'

export function useWorkenvTemplates() {
  return useQuery(orpcUtils.workenv.listTemplates.queryOptions())
}

export function useWorkenvTemplate(id: string | null | undefined) {
  return useQuery({
    ...orpcUtils.workenv.getTemplate.queryOptions({ input: { id: id ?? '' } }),
    enabled: !!id,
  })
}

export function useWorkenvTemplatePrebuildStatus(id: string | null | undefined) {
  return useQuery({
    ...orpcUtils.workenv.getTemplatePrebuildStatus.queryOptions({ input: { id: id ?? '' } }),
    enabled: !!id,
  })
}
