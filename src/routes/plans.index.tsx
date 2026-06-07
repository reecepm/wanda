import { createFileRoute } from '@tanstack/react-router'
import { PlansScreen } from '@/features/plan'

export const Route = createFileRoute('/plans/')({
  component: PlansScreen,
})
