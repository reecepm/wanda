import { z } from 'zod'

const taskViewFiltersSchema = z.object({
  projectIds: z.array(z.string()).optional(),
  statuses: z.array(z.string()).optional(),
  types: z.array(z.string()).optional(),
  priorities: z.array(z.number()).optional(),
})

const taskViewConfigSchema = z.object({
  filters: taskViewFiltersSchema,
  groupBy: z.enum(['status', 'type', 'priority', 'project', 'none']),
  sortBy: z.enum(['created', 'updated', 'priority', 'title', 'status']),
  sortDirection: z.enum(['asc', 'desc']),
  layout: z.enum(['grouped-list', 'board']),
  collapsedGroups: z.array(z.string()),
  showCompletedTasks: z.boolean(),
  fields: z.array(z.enum(['type', 'priority', 'labels', 'project', 'created'])),
})

export const createTaskViewSchema = z.object({
  name: z.string(),
  config: taskViewConfigSchema.optional(),
  sortOrder: z.number().optional(),
})

export const updateTaskViewSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  config: taskViewConfigSchema.optional(),
  sortOrder: z.number().optional(),
})
