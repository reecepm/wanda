import { z } from 'zod'

export const gitContextSchema = z.object({
  repoPath: z.string(),
  baseRef: z.string().optional(),
  source: z.enum(['auto', 'user']),
  worktreePath: z.string().optional(),
  worktreeBranch: z.string().optional(),
})
