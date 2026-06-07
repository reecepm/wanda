import { z } from 'zod'

export const createWorkspaceSchema = z.object({
  name: z.string(),
  cwd: z.string(),
  repoPath: z.string().optional(),
})

export const updateWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  repoPath: z.string().optional(),
  iconUrl: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
})
