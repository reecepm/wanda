import { z } from 'zod'
import { gitContextSchema } from './git-context'
import { podRuntimeSchema } from './runtime'

const containerLifecycleSchema = z.enum(['inherit', 'keep-running', 'stop-on-exit'])
const wandaMcpPolicySchema = z.enum(['inherit', 'include', 'exclude'])

export const createPodSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  cwd: z.string(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  sliceBranch: z.string().optional(),
  containerLifecycle: containerLifecycleSchema.optional(),
  gitContext: gitContextSchema.nullable().optional(),
  runtime: podRuntimeSchema.optional(),
  wandaMcpPolicy: wandaMcpPolicySchema.nullable().optional(),
})

export const updatePodSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  shell: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  sortOrder: z.number().optional(),
  containerLifecycle: containerLifecycleSchema.optional(),
  workspaceId: z.string().optional(),
  runtime: podRuntimeSchema.optional(),
  wandaMcpPolicy: wandaMcpPolicySchema.nullable().optional(),
})
