import { createFileRoute } from '@tanstack/react-router'
import { TasksScreen } from '@/features/tasks'

export const Route = createFileRoute('/tasks')({
  component: TasksScreen,
})
