import { z } from 'zod'

const dockerMountSchema = z.object({
  source: z.string(),
  target: z.string(),
  readonly: z.boolean().optional(),
})

const dockerPortSchema = z.object({
  containerPort: z.number(),
  protocol: z.enum(['tcp', 'udp']).optional(),
  label: z.string().optional(),
})

const dockerResourcesSchema = z.object({
  memory: z.number().optional(),
  cpus: z.number().optional(),
})

export const podRuntimeSchema = z.union([
  z.null(),
  z.object({ type: z.literal('pty') }),
  z.object({
    type: z.literal('docker'),
    image: z.string(),
    resources: dockerResourcesSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    mounts: z.array(dockerMountSchema).optional(),
    workDir: z.string().optional(),
    ports: z.array(dockerPortSchema).optional(),
    ssh: z.boolean().optional(),
  }),
])
