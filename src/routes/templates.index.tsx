import { createFileRoute } from '@tanstack/react-router'
import { TemplatesScreen } from '@/features/pod/components/templates-screen'

export const Route = createFileRoute('/templates/')({
  component: TemplatesScreen,
})
