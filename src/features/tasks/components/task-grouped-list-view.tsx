import type { TaskGroup } from '@/features/tasks/utils/task-filters'
import { TaskStatusGroup } from './task-status-group'

interface TaskGroupedListViewProps {
  groups: TaskGroup[]
  collapsedGroups: string[]
  onToggleGroup: (groupKey: string) => void
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
  checkedIds: Set<string>
  onCheck: (id: string, checked: boolean) => void
  onUpdateField: (taskId: string, field: string, value: unknown) => void
  projectIdentifierMap?: Map<string, string>
}

export function TaskGroupedListView({
  groups,
  collapsedGroups,
  onToggleGroup,
  selectedTaskId,
  onSelectTask,
  checkedIds,
  onCheck,
  onUpdateField,
  projectIdentifierMap,
}: TaskGroupedListViewProps) {
  if (groups.length === 0) {
    return <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">No tasks found</div>
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {groups.map((group) => (
        <TaskStatusGroup
          key={group.key}
          groupKey={group.key}
          label={group.label}
          tasks={group.tasks}
          collapsed={collapsedGroups.includes(group.key)}
          onToggle={() => onToggleGroup(group.key)}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          checkedIds={checkedIds}
          onCheck={onCheck}
          onUpdateField={onUpdateField}
          projectIdentifierMap={projectIdentifierMap}
        />
      ))}
    </div>
  )
}
