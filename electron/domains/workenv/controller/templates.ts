// -----------------------------------------------------------------------------
// WorkenvTemplates — CRUD over `workenv_templates` plus a `compile()` step
// that applies a one-level `extends` chain to a user-submitted config.
//
// Merge rules (mergeWorkenvConfig):
//   - scalars (runtime, worktreePath): user override wins
//   - arrays (mounts, ports, prebuild, bootstrap, postStart, requires): template-first concat
//   - records (env, base, resources): shallow merge, user keys win
//   - healthcheck/workdir: replaced wholesale (no merge), user wins when set
//
// extends is one level deep. compile() throws if a ref can't be resolved —
// silently dropping is too easy a footgun.
// -----------------------------------------------------------------------------

import { Context, Effect, Layer } from 'effect'
import type { WorkenvConfig } from '../../../../shared/contracts/workenv'
import { DatabaseService } from '../../../infra/database'
import {
  type CreateTemplateInput,
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplates,
  seedBuiltInTemplates,
  type UpdateTemplateInput,
  updateTemplate,
  type WorkenvTemplateRow,
} from '../repository/templates'
import { parseTemplateYaml, templateToYaml } from './template-yaml'

/**
 * Merge two template-level partials without requiring runtime/worktreePath.
 * Used by the multi-template `compile()` loop where neither side is the
 * final-form user config.
 */
function mergePartials(a: Partial<WorkenvConfig>, b: Partial<WorkenvConfig>): Partial<WorkenvConfig> {
  const out: Partial<WorkenvConfig> = {}
  if (b.runtime ?? a.runtime) out.runtime = (b.runtime ?? a.runtime) as 'orbstack'
  if (b.worktreePath ?? a.worktreePath) out.worktreePath = b.worktreePath ?? a.worktreePath

  const env = { ...(a.env ?? {}), ...(b.env ?? {}) }
  if (Object.keys(env).length > 0) out.env = env
  const base = { ...(a.base ?? {}), ...(b.base ?? {}) }
  if (Object.keys(base).length > 0) out.base = base
  const resources = { ...(a.resources ?? {}), ...(b.resources ?? {}) }
  if (Object.keys(resources).length > 0) out.resources = resources

  const mounts = [...(a.mounts ?? []), ...(b.mounts ?? [])]
  if (mounts.length > 0) out.mounts = mounts
  const layers = [...(a.layers ?? []), ...(b.layers ?? [])]
  if (layers.length > 0) out.layers = layers
  const ports = [...(a.ports ?? []), ...(b.ports ?? [])]
  if (ports.length > 0) out.ports = ports
  const prebuild = [...(a.prebuild ?? []), ...(b.prebuild ?? [])]
  if (prebuild.length > 0) out.prebuild = prebuild
  const bootstrap = [...(a.bootstrap ?? []), ...(b.bootstrap ?? [])]
  if (bootstrap.length > 0) out.bootstrap = bootstrap
  const postStart = [...(a.postStart ?? []), ...(b.postStart ?? [])]
  if (postStart.length > 0) out.postStart = postStart
  const requires = [...(a.requires ?? []), ...(b.requires ?? [])]
  if (requires.length > 0) out.requires = requires

  if (b.healthcheck ?? a.healthcheck) out.healthcheck = b.healthcheck ?? a.healthcheck
  if (b.workdir ?? a.workdir) out.workdir = b.workdir ?? a.workdir
  return out
}

export function mergeWorkenvConfig(template: Partial<WorkenvConfig>, override: Partial<WorkenvConfig>): WorkenvConfig {
  const runtime = override.runtime ?? template.runtime
  const worktreePath = override.worktreePath ?? template.worktreePath
  if (!runtime || !worktreePath) {
    // Should be impossible if the override is a valid WorkenvConfig; defend
    // against bad partials here so the rest of the merge is total.
    throw new Error('mergeWorkenvConfig: result is missing runtime or worktreePath')
  }

  const merged: WorkenvConfig = {
    runtime,
    worktreePath,
  }

  // --- Records (shallow merge; user keys win) ---
  const env = { ...(template.env ?? {}), ...(override.env ?? {}) }
  if (Object.keys(env).length > 0) merged.env = env

  const base = { ...(template.base ?? {}), ...(override.base ?? {}) }
  if (Object.keys(base).length > 0) merged.base = base

  const resources = { ...(template.resources ?? {}), ...(override.resources ?? {}) }
  if (Object.keys(resources).length > 0) merged.resources = resources

  // --- Arrays (template-first concat) ---
  const mounts = [...(template.mounts ?? []), ...(override.mounts ?? [])]
  if (mounts.length > 0) merged.mounts = mounts

  const layers = [...(template.layers ?? []), ...(override.layers ?? [])]
  if (layers.length > 0) merged.layers = layers

  const ports = [...(template.ports ?? []), ...(override.ports ?? [])]
  if (ports.length > 0) merged.ports = ports

  const prebuild = [...(template.prebuild ?? []), ...(override.prebuild ?? [])]
  if (prebuild.length > 0) merged.prebuild = prebuild

  const bootstrap = [...(template.bootstrap ?? []), ...(override.bootstrap ?? [])]
  if (bootstrap.length > 0) merged.bootstrap = bootstrap

  const postStart = [...(template.postStart ?? []), ...(override.postStart ?? [])]
  if (postStart.length > 0) merged.postStart = postStart

  const requires = [...(template.requires ?? []), ...(override.requires ?? [])]
  if (requires.length > 0) merged.requires = requires

  // --- Replace-wholesale fields ---
  const healthcheck = override.healthcheck ?? template.healthcheck
  if (healthcheck) merged.healthcheck = healthcheck

  const workdir = override.workdir ?? template.workdir
  if (workdir) merged.workdir = workdir

  // `extends` is consumed by compile(), not propagated downstream.
  return merged
}

// ----- Built-in seeds ------------------------------------------------------

/**
 * Bundled starter templates that ship with Wanda. Each template is a
 * pre-composed list of layers from the built-in catalog (see
 * `./builtin-layers.ts`). Stable IDs so re-seeding is idempotent and
 * references in user configs survive upgrades.
 */
import { BUILTIN_STARTER_TEMPLATES } from './builtin-layers'
export const BUILTIN_TEMPLATES = BUILTIN_STARTER_TEMPLATES

// ----- Service -------------------------------------------------------------

export interface WorkenvTemplatesShape {
  readonly list: () => Effect.Effect<WorkenvTemplateRow[]>
  readonly getById: (id: string) => Effect.Effect<WorkenvTemplateRow | undefined>
  readonly create: (input: CreateTemplateInput) => Effect.Effect<WorkenvTemplateRow>
  readonly update: (id: string, input: UpdateTemplateInput) => Effect.Effect<WorkenvTemplateRow>
  readonly delete: (id: string) => Effect.Effect<void>
  readonly exportYaml: (id: string) => Effect.Effect<string, Error>
  readonly importYaml: (
    yaml: string,
    options?: { readonly replaceExisting?: boolean },
  ) => Effect.Effect<WorkenvTemplateRow, Error>
  /**
   * Resolve the user's `extends` refs and return the merged config. v1
   * supports one level — refs in a template's own config are not chased.
   */
  readonly compile: (config: WorkenvConfig) => Effect.Effect<WorkenvConfig, Error>
  /**
   * Insert built-in templates if they don't already exist. Idempotent —
   * safe to call on every server boot.
   */
  readonly seedBuiltIns: () => Effect.Effect<void>
}

export class WorkenvTemplates extends Context.Tag('WorkenvTemplates')<WorkenvTemplates, WorkenvTemplatesShape>() {}

export const WorkenvTemplatesLive = Layer.effect(
  WorkenvTemplates,
  Effect.gen(function* () {
    const db = yield* DatabaseService

    return {
      list: () => Effect.sync(() => listTemplates(db)),
      getById: (id) => Effect.sync(() => getTemplateById(db, id)),
      create: (input) => Effect.sync(() => createTemplate(db, input)),
      update: (id, input) => Effect.sync(() => updateTemplate(db, id, input)),
      delete: (id) => Effect.sync(() => deleteTemplate(db, id)),
      exportYaml: (id) =>
        Effect.sync(() => {
          const tpl = getTemplateById(db, id)
          if (!tpl) throw new Error(`workenv template ${id} not found`)
          return templateToYaml(tpl)
        }),
      importYaml: (yaml, options) =>
        Effect.sync(() => {
          const parsed = parseTemplateYaml(yaml)
          const existing = parsed.id ? getTemplateById(db, parsed.id) : undefined

          if (existing) {
            if (options?.replaceExisting) {
              if (existing.builtIn) {
                throw new Error(`cannot replace built-in template ${existing.id}`)
              }
              return updateTemplate(db, existing.id, {
                name: parsed.name,
                description: parsed.description,
                runtime: parsed.runtime,
                config: parsed.config,
              })
            }
            return createTemplate(db, {
              name: parsed.name,
              description: parsed.description,
              runtime: parsed.runtime,
              config: parsed.config,
            })
          }

          return createTemplate(db, {
            id: parsed.id,
            name: parsed.name,
            description: parsed.description,
            runtime: parsed.runtime,
            config: parsed.config,
          })
        }),

      compile: (config) =>
        Effect.gen(function* () {
          const refs = config.extends ?? []
          if (refs.length === 0) return config

          // Accumulate template partials in declaration order, then merge
          // with the user config last so the user wins on scalars.
          let acc: Partial<WorkenvConfig> = {}
          for (const ref of refs) {
            const tpl = getTemplateById(db, ref)
            if (!tpl) {
              return yield* Effect.fail(new Error(`unknown template ref: ${ref}`))
            }
            acc = mergePartials(acc, tpl.config)
          }
          return mergeWorkenvConfig(acc, config)
        }),

      seedBuiltIns: () =>
        Effect.sync(() => {
          seedBuiltInTemplates(db, BUILTIN_TEMPLATES)
        }),
    }
  }),
)
