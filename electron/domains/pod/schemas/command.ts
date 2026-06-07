import { z } from 'zod'

const commandArgSchema = z.object({
  name: z.string(),
  required: z.boolean(),
  default: z.string().optional(),
})

export const addCommandSchema = z.object({
  podId: z.string(),
  name: z.string(),
  command: z.string(),
  directory: z.string().optional(),
  directoryMode: z.enum(['absolute', 'relative']).optional(),
  autoStart: z.boolean().optional(),
  args: z.array(commandArgSchema).optional(),
})

export const updateCommandSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  command: z.string().optional(),
  directory: z.string().nullable().optional(),
  directoryMode: z.enum(['absolute', 'relative']).optional(),
  autoStart: z.boolean().optional(),
  sortOrder: z.number().optional(),
  args: z.array(commandArgSchema).nullable().optional(),
})

const importCommandSchema = z.object({
  name: z.string(),
  command: z.string(),
  directory: z.string().optional(),
  directoryMode: z.enum(['absolute', 'relative']).optional(),
  autoStart: z.boolean().optional(),
  args: z.array(commandArgSchema).optional(),
  tagNames: z.array(z.string()).optional(),
})

export const importCommandsSchema = z.object({
  podId: z.string(),
  commands: z.array(importCommandSchema),
})
