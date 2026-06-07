import type { Task } from '@wanda/tasks'
import { RiArrowDownSLine, RiArrowRightSLine } from '@/lib/icons'
import { TaskRow } from './task-row'
import { TaskStatusIcon } from './task-status-icon'

interface TaskStatusGroupProps {
  groupKey: string
  label: string
  tasks: Task[]
  collapsed: boolean
  onToggle: () => void
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  checkedIds: Set<string>
  onCheck: (id: string, checked: boolean) => void
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  projectIdentifierMap?: Map<string, string>
}

export function TaskStatusGroup({
  groupKey,
  label,
  tasks,
  collapsed,
  onToggle,
  selectedTaskId,
  onSelectTask,
  checkedIds,
  onCheck,
  onUpdateField,
  projectIdentifierMap,
}: TaskStatusGroupProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-accent/30 transition-colors sticky top-0 bg-background z-10"
      >
        {collapsed ? (
          <RiArrowRightSLine className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <RiArrowDownSLine className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <TaskStatusIcon status={groupKey as Task['status']} className="shrink-0" />
        <span className="text-xs font-medium text-foreground leading-none">{label}</span>
        <span className="text-[10px] text-muted-foreground ml-0.5 leading-none">{tasks.length}</span>
      </button>

      {!collapsed && (
        <div>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              checked={checkedIds.has(task.id)}
              onSelect={onSelectTask}
              onCheck={onCheck}
              onUpdateField={onUpdateField}
              projectIdentifier={task.projectId ? projectIdentifierMap?.get(task.projectId) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}
