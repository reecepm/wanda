import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcUtils } from '@/shared/orpc'

/**
 * Mutations for workenv templates. Invalidate `listTemplates` on every
 * success so the picker and list routes refresh; when an individual
 * template is touched, also invalidate its `getTemplate` query.
 */
export function useWorkenvTemplateActions() {
  const qc = useQueryClient()

  const invalidateList = () => qc.invalidateQueries({ queryKey: orpcUtils.workenv.listTemplates.queryKey() })
  const invalidateOne = (id: string) =>
    qc.invalidateQueries({ queryKey: orpcUtils.workenv.getTemplate.queryKey({ input: { id } }) })
  const invalidatePrebuild = (id: string) =>
    qc.invalidateQueries({
      queryKey: orpcUtils.workenv.getTemplatePrebuildStatus.queryKey({ input: { id } }),
    })

  const create = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.createTemplate.call>[0]) =>
      orpcUtils.workenv.createTemplate.call(input),
    onSuccess: () => {
      void invalidateList()
    },
  })

  const update = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.updateTemplate.call>[0]) =>
      orpcUtils.workenv.updateTemplate.call(input),
    onSuccess: (_data, { id }) => {
      void invalidateList()
      void invalidateOne(id)
      void invalidatePrebuild(id)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.deleteTemplate.call({ id }),
    onSuccess: () => {
      void invalidateList()
    },
  })

  const prebuild = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.prebuildTemplate.call({ id }),
    onSuccess: (_data, id) => {
      void invalidateOne(id)
      void invalidatePrebuild(id)
    },
  })

  const exportYaml = useMutation({
    mutationFn: (id: string) => orpcUtils.workenv.exportTemplateYaml.call({ id }),
  })

  const importYaml = useMutation({
    mutationFn: (input: Parameters<typeof orpcUtils.workenv.importTemplateYaml.call>[0]) =>
      orpcUtils.workenv.importTemplateYaml.call(input),
    onSuccess: (template) => {
      void invalidateList()
      void invalidateOne(template.id)
      void invalidatePrebuild(template.id)
    },
  })

  return { create, update, remove, prebuild, exportYaml, importYaml }
}
