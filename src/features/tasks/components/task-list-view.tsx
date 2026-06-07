import type { Task } from '@wanda/tasks'
import { TaskStatusBadge } from './task-status-badge'

interface TaskListViewProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  statusFilter: string | null
  onStatusFilterChange: (status: string | null) => void
}

const STATUS_FILTERS = ['all', 'pending', 'ready', 'in_progress', 'completed', 'failed', 'blocked'] as const

export function TaskListView({
  tasks,
  selectedTaskId,
  onSelectTask,
  statusFilter,
  onStatusFilterChange,
}: TaskListViewProps) {
  const filteredTasks = statusFilter && statusFilter !== 'all' ? tasks.filter((t) => t.status === statusFilter) : tasks

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800">
        {STATUS_FILTERS.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => onStatusFilterChange(status === 'all' ? null : status)}
            className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${
              (status === 'all' && !statusFilter) || status === statusFilter
                ? 'bg-zinc-700 text-zinc-200'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {status === 'all' ? `All (${tasks.length})` : status}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredTasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-zinc-600">No tasks found</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="text-left font-medium px-3 py-1.5">Title</th>
                <th className="text-left font-medium px-3 py-1.5 w-24">Status</th>
                <th className="text-left font-medium px-3 py-1.5 w-20">Type</th>
                <th className="text-left font-medium px-3 py-1.5 w-16">Priority</th>
                <th className="text-left font-medium px-3 py-1.5 w-20">Deps</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => onSelectTask(task.id!)}
                  className={`cursor-pointer border-b border-zinc-800/50 transition-colors ${
                    selectedTaskId === task.id ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
                  }`}
                >
                  <td className="px-3 py-1.5 text-zinc-200 truncate max-w-0">{task.title}</td>
                  <td className="px-3 py-1.5">
                    <TaskStatusBadge status={task.status!} />
                  </td>
                  <td className="px-3 py-1.5 text-zinc-400">{task.type}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{task.priority}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{task.dependsOn?.length || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
