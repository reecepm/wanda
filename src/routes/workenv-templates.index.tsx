import { createFileRoute } from '@tanstack/react-router'
import { WorkenvTemplatesScreen } from '@/features/workenv'

export const Route = createFileRoute('/workenv-templates/')({
  component: WorkenvTemplatesScreen,
})
