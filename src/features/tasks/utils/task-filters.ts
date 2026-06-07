import type { Project, Task } from '@wanda/tasks'
import type { TaskFilterConfig } from '@/types/schema'

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
}

const STATUS_ORDER = ['pending', 'ready', 'in_progress', 'blocked', 'completed', 'failed']
const TYPE_ORDER = ['epic', 'story', 'task', 'subtask']

export function applyTaskFilters(tasks: Task[], filters: TaskFilterConfig): Task[] {
  let result = tasks

  if (filters.projectIds?.length) {
    const set = new Set(filters.projectIds)
    result = result.filter((t) => t.projectId && set.has(t.projectId))
  }

  if (filters.statuses?.length) {
    const set = new Set(filters.statuses)
    result = result.filter((t) => t.status && set.has(t.status))
  }

  if (filters.types?.length) {
    const set = new Set(filters.types)
    result = result.filter((t) => t.type && set.has(t.type))
  }

  if (filters.priorities?.length) {
    const set = new Set(filters.priorities)
    result = result.filter((t) => t.priority != null && set.has(t.priority))
  }

  return result
}

export function sortTasks(tasks: Task[], sortBy: string, direction: 'asc' | 'desc'): Task[] {
  const sorted = [...tasks].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return (a.title ?? '').localeCompare(b.title ?? '')
      case 'priority':
        return (b.priority ?? 0) - (a.priority ?? 0)
      case 'status':
        return STATUS_ORDER.indexOf(a.status ?? '') - STATUS_ORDER.indexOf(b.status ?? '')
      case 'updated':
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
      case 'created':
      default:
        return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
    }
  })

  return direction === 'asc' ? sorted.reverse() : sorted
}

export function groupTasks(tasks: Task[], groupBy: string, projects?: Project[]): TaskGroup[] {
  if (groupBy === 'none') {
    return [{ key: 'all', label: 'All Tasks', tasks }]
  }

  const projectMap = new Map<string, string>()
  if (projects) {
    for (const p of projects) {
      if (p.id && p.name) projectMap.set(p.id, p.name)
    }
  }

  const grouped = new Map<string, Task[]>()

  for (const task of tasks) {
    let key: string
    switch (groupBy) {
      case 'status':
        key = task.status ?? 'unknown'
        break
      case 'type':
        key = task.type ?? 'task'
        break
      case 'priority': {
        const p = task.priority ?? 0
        key = String(p)
        break
      }
      case 'project':
        key = task.projectId ?? 'unknown'
        break
      default:
        key = 'all'
    }

    const arr = grouped.get(key)
    if (arr) arr.push(task)
    else grouped.set(key, [task])
  }

  // Determine group order
  let orderedKeys: string[]
  switch (groupBy) {
    case 'status':
      orderedKeys = STATUS_ORDER
      break
    case 'type':
      orderedKeys = TYPE_ORDER
      break
    case 'priority':
      orderedKeys = [...grouped.keys()].sort((a, b) => Number(b) - Number(a))
      break
    case 'project':
      orderedKeys = [...grouped.keys()].sort((a, b) => {
        const nameA = projectMap.get(a) ?? a
        const nameB = projectMap.get(b) ?? b
        return nameA.localeCompare(nameB)
      })
      break
    default:
      orderedKeys = [...grouped.keys()]
  }

  // Add any keys from the map that aren't in the predefined order
  for (const key of grouped.keys()) {
    if (!orderedKeys.includes(key)) orderedKeys.push(key)
  }

  return orderedKeys
    .map((key) => ({
      key,
      label: getGroupLabel(groupBy, key, projectMap),
      tasks: grouped.get(key) ?? [],
    }))
    .filter((g) => g.tasks.length > 0)
}

function getGroupLabel(groupBy: string, key: string, projectMap: Map<string, string>): string {
  switch (groupBy) {
    case 'status':
      return key.charAt(0).toUpperCase() + key.slice(1)
    case 'type':
      return key.charAt(0).toUpperCase() + key.slice(1)
    case 'priority': {
      const p = Number(key)
      if (p === 0) return 'No priority'
      if (p === 1) return 'Urgent'
      if (p === 2) return 'High'
      if (p === 3) return 'Medium'
      if (p === 4) return 'Low'
      return `Priority ${p}`
    }
    case 'project':
      return projectMap.get(key) ?? key
    default:
      return key
  }
}

export function filterByQuickSearch(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return tasks
  const lower = query.toLowerCase()
  return tasks.filter((t) => t.title?.toLowerCase().includes(lower) || t.description?.toLowerCase().includes(lower))
}

export function formatRelativeTime(date: string | number | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diffMs = now - then

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
