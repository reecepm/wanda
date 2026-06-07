import { createFileRoute } from '@tanstack/react-router'
import { PlanEditorScreen } from '@/features/plan'

export const Route = createFileRoute('/plans/$planId')({
  component: PlanEditorRoute,
})

function PlanEditorRoute() {
  const { planId } = Route.useParams()
  return <PlanEditorScreen planId={planId} />
}
