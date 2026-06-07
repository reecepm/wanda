import { z } from 'zod'

const restartPolicySchema = z.enum(['never', 'on-failure', 'always'])

export const addTerminalSchema = z.object({
  podId: z.string(),
  name: z.string(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  restartPolicy: restartPolicySchema.optional(),
})

export const updateTerminalSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  restartPolicy: restartPolicySchema.optional(),
  sortOrder: z.number().optional(),
})
