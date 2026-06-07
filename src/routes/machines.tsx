import { createFileRoute } from '@tanstack/react-router'
import { MachinesScreen } from '@/features/servers/components/machines-screen'

export const Route = createFileRoute('/machines')({
  component: MachinesScreen,
})
