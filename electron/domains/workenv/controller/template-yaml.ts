import { dump, load } from 'js-yaml'
import { z } from 'zod'
import { type WorkenvRuntime, workenvConfigSchema, workenvRuntimeSchema } from '../../../../shared/contracts/workenv'
import type { WorkenvTemplateRow } from '../repository/templates'

const WORKENV_TEMPLATE_YAML_KIND = 'wanda.workenv.template'
const WORKENV_TEMPLATE_YAML_VERSION = 1

const workenvTemplateYamlSchema = z
  .object({
    kind: z.literal(WORKENV_TEMPLATE_YAML_KIND),
    version: z.literal(WORKENV_TEMPLATE_YAML_VERSION),
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    runtime: workenvRuntimeSchema,
    config: workenvConfigSchema.partial(),
  })
  .strict()

type WorkenvTemplateYaml = z.infer<typeof workenvTemplateYamlSchema>

interface ParsedWorkenvTemplateYaml {
  readonly id?: string
  readonly name: string
  readonly description: string | null
  readonly runtime: WorkenvRuntime
  readonly config: WorkenvTemplateYaml['config']
}

export function templateToYaml(template: WorkenvTemplateRow): string {
  const doc: WorkenvTemplateYaml = {
    kind: WORKENV_TEMPLATE_YAML_KIND,
    version: WORKENV_TEMPLATE_YAML_VERSION,
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    runtime: template.runtime,
    config: template.config,
  }
  return dump(doc, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })
}

export function parseTemplateYaml(yaml: string): ParsedWorkenvTemplateYaml {
  let raw: unknown
  try {
    raw = load(yaml)
  } catch (err) {
    throw new Error(`invalid YAML: ${err instanceof Error ? err.message : String(err)}`)
  }

  const unknownPath = firstUnknownPath(raw)
  if (unknownPath) {
    throw new Error(`invalid workenv template YAML: unknown field: ${unknownPath}`)
  }

  const result = workenvTemplateYamlSchema.safeParse(raw)
  if (!result.success) {
    const issue = result.error.issues[0]
    const path = issue?.path.length ? `${issue.path.join('.')}: ` : ''
    throw new Error(`invalid workenv template YAML: ${path}${issue?.message ?? 'unknown error'}`)
  }

  return {
    id: result.data.id,
    name: result.data.name,
    description: result.data.description ?? null,
    runtime: result.data.runtime,
    config: result.data.config,
  }
}

function firstUnknownPath(value: unknown): string | null {
  if (!isRecord(value)) return null
  const top = checkKeys(value, new Set(['kind', 'version', 'id', 'name', 'description', 'runtime', 'config']), '')
  if (top) return top
  return firstUnknownConfigPath(value.config, 'config')
}

function firstUnknownConfigPath(value: unknown, path: string): string | null {
  if (!isRecord(value)) return null
  const err = checkKeys(
    value,
    new Set([
      'runtime',
      'worktreePath',
      'extends',
      'base',
      'resources',
      'mounts',
      'ports',
      'env',
      'prebuild',
      'bootstrap',
      'postStart',
      'layers',
      'workdir',
      'healthcheck',
      'requires',
    ]),
    path,
  )
  if (err) return err
  return (
    firstUnknownObjectPath(value.base, `${path}.base`, ['image', 'arch']) ??
    firstUnknownObjectPath(value.resources, `${path}.resources`, ['cpus', 'memoryMB', 'diskGB']) ??
    firstUnknownObjectPath(value.healthcheck, `${path}.healthcheck`, ['cmd', 'intervalSec', 'startPeriodSec']) ??
    firstUnknownArrayPath(value.mounts, `${path}.mounts`, firstUnknownMountPath) ??
    firstUnknownArrayPath(value.ports, `${path}.ports`, firstUnknownPortPath) ??
    firstUnknownEnvPath(value.env, `${path}.env`) ??
    firstUnknownArrayPath(value.prebuild, `${path}.prebuild`, firstUnknownBootstrapStepPath) ??
    firstUnknownArrayPath(value.bootstrap, `${path}.bootstrap`, firstUnknownBootstrapStepPath) ??
    firstUnknownArrayPath(value.postStart, `${path}.postStart`, firstUnknownBootstrapStepPath) ??
    firstUnknownArrayPath(value.layers, `${path}.layers`, firstUnknownLayerPath)
  )
}

function firstUnknownLayerPath(value: unknown, path: string): string | null {
  if (!isRecord(value)) return null
  const kind = typeof value.kind === 'string' ? value.kind : ''
  const baseKeys = ['kind', 'id']
  if (kind === 'base') {
    return (
      firstUnknownObjectPath(value, path, [...baseKeys, 'image', 'arch', 'install']) ??
      firstUnknownArrayPath(value.install, `${path}.install`, firstUnknownLayerShellStepPath)
    )
  }
  if (kind === 'pkg') return firstUnknownObjectPath(value, path, [...baseKeys, 'manager', 'packages'])
  if (kind === 'tool') {
    return (
      firstUnknownObjectPath(value, path, [...baseKeys, 'name', 'install', 'verify', 'params']) ??
      firstUnknownArrayPath(value.install, `${path}.install`, firstUnknownLayerShellStepPath) ??
      firstUnknownArrayPath(value.verify, `${path}.verify`, firstUnknownLayerShellStepPath)
    )
  }
  if (kind === 'service') {
    return (
      firstUnknownObjectPath(value, path, [...baseKeys, 'name', 'image', 'ports', 'env']) ??
      firstUnknownArrayPath(value.ports, `${path}.ports`, firstUnknownPortPath)
    )
  }
  if (kind === 'auth') {
    return (
      firstUnknownObjectPath(value, path, [...baseKeys, 'name', 'mounts', 'env', 'resolveEnv', 'resolveFiles']) ??
      firstUnknownArrayPath(value.mounts, `${path}.mounts`, firstUnknownMountPath) ??
      firstUnknownEnvPath(value.env, `${path}.env`)
    )
  }
  if (kind === 'shell') {
    return (
      firstUnknownObjectPath(value, path, [...baseKeys, 'name', 'steps']) ??
      firstUnknownArrayPath(value.steps, `${path}.steps`, firstUnknownLayerShellStepPath)
    )
  }
  return null
}

function firstUnknownBootstrapStepPath(value: unknown, path: string): string | null {
  if (!isRecord(value)) return null
  const kind = typeof value.kind === 'string' ? value.kind : ''
  const baseKeys = ['kind', 'label', 'cwd', 'asUser', 'idempotencyKey', 'skipWhenPrebuilt']
  if (kind === 'shell') return firstUnknownObjectPath(value, path, [...baseKeys, 'run'])
  if (kind === 'script' || kind === 'hostScript') return firstUnknownObjectPath(value, path, [...baseKeys, 'path'])
  if (kind === 'recipe') return firstUnknownObjectPath(value, path, ['kind', 'ref', 'with'])
  return null
}

function firstUnknownLayerShellStepPath(value: unknown, path: string): string | null {
  return firstUnknownObjectPath(value, path, ['run', 'asUser', 'idempotencyKey'])
}

function firstUnknownMountPath(value: unknown, path: string): string | null {
  return firstUnknownObjectPath(value, path, ['host', 'guest', 'mode', 'kind', 'cacheKey'])
}

function firstUnknownPortPath(value: unknown, path: string): string | null {
  return firstUnknownObjectPath(value, path, ['name', 'guest', 'host', 'protocol'])
}

function firstUnknownEnvPath(value: unknown, path: string): string | null {
  if (!isRecord(value)) return null
  for (const [key, envValue] of Object.entries(value)) {
    if (isRecord(envValue)) {
      const err = firstUnknownObjectPath(envValue, `${path}.${key}`, ['fromSecret', 'fromHost'])
      if (err) return err
    }
  }
  return null
}

function firstUnknownArrayPath(
  value: unknown,
  path: string,
  check: (entry: unknown, path: string) => string | null,
): string | null {
  if (!Array.isArray(value)) return null
  for (let i = 0; i < value.length; i++) {
    const err = check(value[i], `${path}.${i}`)
    if (err) return err
  }
  return null
}

function firstUnknownObjectPath(value: unknown, path: string, allowed: readonly string[]): string | null {
  if (!isRecord(value)) return null
  return checkKeys(value, new Set(allowed), path)
}

function checkKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return path ? `${path}.${key}` : key
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
