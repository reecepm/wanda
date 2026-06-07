import { createFileRoute } from '@tanstack/react-router'
import { PodScreen } from '@/features/pod/components/pod-screen'

export const Route = createFileRoute('/templates/$templateId')({
  component: TemplateEditorRoute,
})

function TemplateEditorRoute() {
  const { templateId } = Route.useParams()
  return <PodScreen podId={templateId} isTemplate />
}
