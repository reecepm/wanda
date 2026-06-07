import type { TaskStatus } from '@wanda/tasks'
import { RiCircleLine, RiFolderLine, RiRobotLine, RiSignalTowerLine, RiStackLine, RiUserLine } from '@/lib/icons'
import { TaskPriorityIcon } from '../task-priority-icon'
import { TaskStatusIcon } from '../task-status-icon'
import type { FilterFieldConfig } from './types'

// ---------------------------------------------------------------------------
// Priority labels
// ---------------------------------------------------------------------------

export const priorityLabels: Record<string, string> = {
  '0': 'None',
  '1': 'Low',
  '2': 'Medium',
  '3': 'High',
  '4': 'Urgent',
}

// ---------------------------------------------------------------------------
// Static field configurations
// ---------------------------------------------------------------------------

const statusOptions: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: 'draft', label: 'Draft', icon: <TaskStatusIcon status={'draft' as TaskStatus} /> },
  { value: 'pending', label: 'Pending', icon: <TaskStatusIcon status={'pending' as TaskStatus} /> },
  { value: 'ready', label: 'Ready', icon: <TaskStatusIcon status={'ready' as TaskStatus} /> },
  { value: 'in_progress', label: 'In Progress', icon: <TaskStatusIcon status={'in_progress' as TaskStatus} /> },
  { value: 'blocked', label: 'Blocked', icon: <TaskStatusIcon status={'blocked' as TaskStatus} /> },
  { value: 'completed', label: 'Completed', icon: <TaskStatusIcon status={'completed' as TaskStatus} /> },
  { value: 'failed', label: 'Failed', icon: <TaskStatusIcon status={'failed' as TaskStatus} /> },
]

const priorityOptions: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: '4', label: 'Urgent', icon: <TaskPriorityIcon priority={4} /> },
  { value: '3', label: 'High', icon: <TaskPriorityIcon priority={3} /> },
  { value: '2', label: 'Medium', icon: <TaskPriorityIcon priority={2} /> },
  { value: '1', label: 'Low', icon: <TaskPriorityIcon priority={1} /> },
  { value: '0', label: 'None', icon: <TaskPriorityIcon priority={0} /> },
]

export const STATIC_FIELDS: FilterFieldConfig[] = [
  {
    field: 'status',
    label: 'Status',
    icon: RiCircleLine,
    multi: true,
    options: statusOptions,
  },
  {
    field: 'type',
    label: 'Type',
    icon: RiStackLine,
    multi: true,
    options: [
      { value: 'milestone', label: 'Milestone' },
      { value: 'epic', label: 'Epic' },
      { value: 'task', label: 'Task' },
      { value: 'subtask', label: 'Subtask' },
    ],
  },
  {
    field: 'priority',
    label: 'Priority',
    icon: RiSignalTowerLine,
    multi: true,
    options: priorityOptions,
  },
  {
    field: 'assignable',
    label: 'Assignable',
    icon: RiUserLine,
    multi: true,
    options: [
      { value: 'human', label: 'Human' },
      { value: 'agent', label: 'Agent' },
      { value: 'either', label: 'Either' },
    ],
  },
  {
    field: 'origin',
    label: 'Origin',
    icon: RiRobotLine,
    multi: true,
    options: [
      { value: 'human', label: 'Human' },
      { value: 'agent', label: 'Agent' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Dynamic project field builder
// ---------------------------------------------------------------------------

export function buildProjectField(projects: { id: string; name: string; identifier: string }[]): FilterFieldConfig {
  return {
    field: 'project',
    label: 'Project',
    icon: RiFolderLine,
    multi: true,
    options: projects.map((p) => ({
      value: p.id,
      label: p.name,
    })),
  }
}
