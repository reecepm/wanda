import { createFileRoute } from '@tanstack/react-router'
import { PodScreen } from '@/features/pod/components/pod-screen'

export const Route = createFileRoute('/pods/$podId')({
  component: PodRoute,
})

function PodRoute() {
  const { podId } = Route.useParams()
  return <PodScreen podId={podId} />
}
