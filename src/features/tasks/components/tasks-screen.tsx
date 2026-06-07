import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Project, Task, TaskType } from '@wanda/tasks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { orpcUtils } from '@/shared/orpc'
import type { TaskViewConfig } from '@/types/schema'
import { useTaskStore } from '../store/task-store'
import { applyTaskFilters, filterByQuickSearch, groupTasks, sortTasks } from '../utils/task-filters'
import { TaskBoardView } from './task-board-view'
import { TaskCreateDialog } from './task-create-dialog'
import { TaskDetailPanel } from './task-detail-panel'
import { TaskGroupedListView } from './task-grouped-list-view'
import { TaskViewToolbar } from './task-view-toolbar'

const COMPLETED_STATUSES = new Set(['completed', 'failed'])
const DEFAULT_TASK_VIEW_CONFIG: TaskViewConfig = {
  filters: {},
  groupBy: 'status',
  sortBy: 'created',
  sortDirection: 'desc',
  layout: 'grouped-list',
  collapsedGroups: [],
  showCompletedTasks: false,
  fields: ['type', 'priority', 'project', 'created'],
}

export function TasksScreen() {
  const queryClient = useQueryClient()
  const { activeViewId, setActiveViewId, selectedTaskId, setSelectedTaskId, quickFilter } = useTaskStore()
  const [creating, setCreating] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const { data: tasks = [] } = useQuery({
    ...orpcUtils.tasks.list.queryOptions({ input: {} }),
    refetchInterval: 5_000,
  }) as { data: Task[] }

  const { data: projects = [] } = useQuery({
    ...orpcUtils.tasks.listProjects.queryOptions({}),
    refetchInterval: 30_000,
  }) as { data: Project[] }

  const { data: taskViews = [] } = useQuery(orpcUtils.taskView.list.queryOptions())

  const ensuredRef = useRef(false)
  useEffect(() => {
    if (taskViews.length === 0 && !ensuredRef.current) {
      ensuredRef.current = true
      orpcUtils.taskView.ensureDefaults.call({}).then(() => {
        queryClient.invalidateQueries({ queryKey: orpcUtils.taskView.list.key() })
      })
    }
  }, [taskViews.length, queryClient])

  useEffect(() => {
    const firstView = taskViews[0]
    if (!activeViewId && firstView) {
      setActiveViewId(firstView.id)
    }
  }, [activeViewId, taskViews, setActiveViewId])

  const activeView = taskViews.find((view) => view.id === activeViewId)
  const config: TaskViewConfig = useMemo(() => activeView?.config ?? DEFAULT_TASK_VIEW_CONFIG, [activeView?.config])

  const projectIdentifierMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const project of projects) {
      if (project.id && project.identifier) map.set(project.id, project.identifier)
    }
    return map
  }, [projects])

  const processedGroups = useMemo(() => {
    let filtered = applyTaskFilters(tasks, config.filters)

    if (!config.showCompletedTasks && !config.filters.statuses?.length) {
      filtered = filtered.filter((task) => !COMPLETED_STATUSES.has(task.status ?? ''))
    }

    filtered = filterByQuickSearch(filtered, quickFilter)

    const sorted = sortTasks(filtered, config.sortBy, config.sortDirection)

    return groupTasks(sorted, config.groupBy, projects)
  }, [tasks, config, quickFilter, projects])

  const updateTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleConfigChange = useCallback(
    (newConfig: TaskViewConfig) => {
      if (!activeViewId) return
      queryClient.setQueryData(orpcUtils.taskView.list.queryKey(), (old: typeof taskViews | undefined) =>
        old?.map((view) => (view.id === activeViewId ? { ...view, config: newConfig } : view)),
      )
      clearTimeout(updateTimerRef.current)
      updateTimerRef.current = setTimeout(() => {
        orpcUtils.taskView.update.call({ id: activeViewId, config: newConfig })
      }, 300)
    },
    [activeViewId, queryClient],
  )

  const handleToggleGroup = useCallback(
    (groupKey: string) => {
      const collapsed = config.collapsedGroups.includes(groupKey)
        ? config.collapsedGroups.filter((key) => key !== groupKey)
        : [...config.collapsedGroups, groupKey]
      handleConfigChange({ ...config, collapsedGroups: collapsed })
    },
    [config, handleConfigChange],
  )

  const flatFilteredTasks = useMemo(() => {
    let filtered = applyTaskFilters(tasks, config.filters)
    filtered = filterByQuickSearch(filtered, quickFilter)
    return sortTasks(filtered, config.sortBy, config.sortDirection)
  }, [tasks, config, quickFilter])

  const handleCheck = useCallback((id: string, checked: boolean) => {
    setCheckedIds((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleUpdateField = useCallback(
    async (taskId: string, field: string, value: unknown) => {
      const task = tasks.find((candidate) => candidate.id === taskId)
      if (!task) return

      if (field === '_delete') {
        await orpcUtils.tasks.delete.call({ id: taskId })
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
        return
      }

      queryClient.setQueryData(orpcUtils.tasks.list.queryKey({ input: {} }), (old: Task[] | undefined) =>
        old?.map((candidate) => (candidate.id === taskId ? { ...candidate, [field]: value } : candidate)),
      )

      try {
        await orpcUtils.tasks.update.call({
          id: taskId,
          expectedVersion: task.version,
          [field]: value,
        })
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
      } catch {
        queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
      }
    },
    [tasks, queryClient],
  )

  async function handleCreateTask(data: {
    projectId?: string
    title: string
    description?: string
    content?: string
    type?: TaskType
    priority?: number
    dependsOn?: string[]
    labels?: Record<string, string>
  }) {
    await orpcUtils.tasks.create.call(data)
    queryClient.invalidateQueries({ queryKey: orpcUtils.tasks.list.key() })
    setCreating(false)
  }

  return (
    <div className="flex h-full flex-col">
      <TaskViewToolbar
        views={taskViews}
        config={config}
        onConfigChange={handleConfigChange}
        projects={projects}
        onCreateTask={() => setCreating(true)}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        {config.layout === 'grouped-list' ? (
          <TaskGroupedListView
            groups={processedGroups}
            collapsedGroups={config.collapsedGroups}
            onToggleGroup={handleToggleGroup}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            checkedIds={checkedIds}
            onCheck={handleCheck}
            onUpdateField={handleUpdateField}
            projectIdentifierMap={projectIdentifierMap}
          />
        ) : (
          <TaskBoardView
            tasks={flatFilteredTasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onUpdateField={handleUpdateField}
            projectIdentifierMap={projectIdentifierMap}
          />
        )}
      </div>

      <TaskDetailPanel taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />

      {creating && (
        <TaskCreateDialog
          projectId={projects[0]?.id}
          projects={projects}
          onSubmit={handleCreateTask}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  )
}
