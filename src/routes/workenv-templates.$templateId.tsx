import { createFileRoute } from '@tanstack/react-router'
import { WorkenvTemplateEditorScreen } from '@/features/workenv'

export const Route = createFileRoute('/workenv-templates/$templateId')({
  component: WorkenvTemplateEditorRoute,
})

function WorkenvTemplateEditorRoute() {
  const { templateId } = Route.useParams()
  return <WorkenvTemplateEditorScreen templateId={templateId} />
}
