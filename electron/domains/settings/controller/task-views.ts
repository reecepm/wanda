import { Context, Effect, Layer } from 'effect'
import { DatabaseService } from '../../../infra/database'
import {
  createTaskView,
  deleteTaskView,
  getTaskViewById,
  listTaskViews,
  type TaskViewRow,
  type TaskViewUpdateInput,
  updateTaskView,
} from '../repository'
import type { TaskViewConfig } from '../types'

const DEFAULT_CONFIG: TaskViewConfig = {
  filters: {},
  groupBy: 'status',
  sortBy: 'created',
  sortDirection: 'desc',
  layout: 'grouped-list',
  collapsedGroups: [],
  showCompletedTasks: false,
  fields: ['type', 'priority', 'project', 'created'],
}

interface TaskViewControllerShape {
  readonly list: () => Effect.Effect<TaskViewRow[]>
  readonly getById: (id: string) => Effect.Effect<TaskViewRow | undefined>
  readonly create: (input: { name: string; config?: TaskViewConfig; sortOrder?: number }) => Effect.Effect<TaskViewRow>
  readonly update: (id: string, input: TaskViewUpdateInput) => Effect.Effect<TaskViewRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly ensureDefaults: () => Effect.Effect<TaskViewRow[]>
}

export class TaskViewController extends Context.Tag('TaskViewController')<
  TaskViewController,
  TaskViewControllerShape
>() {}

export const TaskViewControllerLive = Layer.effect(
  TaskViewController,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      list: () => Effect.sync(() => listTaskViews(db)),
      getById: (id) => Effect.sync(() => getTaskViewById(db, id)),
      create: (input) => Effect.sync(() => createTaskView(db, { ...input, config: input.config ?? DEFAULT_CONFIG })),
      update: (id, input) => Effect.sync(() => updateTaskView(db, id, input)),
      delete: (id) => Effect.sync(() => deleteTaskView(db, id)),

      ensureDefaults: () =>
        Effect.sync(() => {
          const existing = listTaskViews(db)
          if (existing.length > 0) return existing

          createTaskView(db, { name: 'All Tasks', config: DEFAULT_CONFIG, sortOrder: 0 })
          createTaskView(db, { name: 'Board', config: { ...DEFAULT_CONFIG, layout: 'board' }, sortOrder: 1 })
          return listTaskViews(db)
        }),
    }
  }),
)
