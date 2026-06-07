// -----------------------------------------------------------------------------
// Workenv test fixtures.
//
// Pure factory functions that produce shaped, schema-valid objects for unit
// tests. Defaults match the "minimum viable" config (`{ runtime,
// worktreePath }`) and the post-create database row state (state=stopped,
// adapterHandle=null).
// -----------------------------------------------------------------------------

import { v4 as uuid } from 'uuid'
import type {
  WorkenvBootstrapStep,
  WorkenvConfig,
  WorkenvEventType,
  WorkenvResolvedPort,
  WorkenvRuntime,
  WorkenvState,
} from '../../shared/contracts/workenv'
import type { WorkenvRuntimeState } from '../../shared/contracts/workenv-runtime-state'

let slugCounter = 0
function nextSlug(prefix: string): string {
  slugCounter += 1
  return `${prefix}-${slugCounter}`
}

// ---- Workenv row ----------------------------------------------------------

export interface MockWorkenvOverrides {
  id?: string
  name?: string
  slug?: string
  worktreePath?: string
  runtime?: WorkenvRuntime
  adapterHandle?: string | null
  state?: WorkenvState
  configHash?: string
  config?: WorkenvConfig
  runtimeState?: WorkenvRuntimeState | null
  resolvedPorts?: WorkenvResolvedPort[] | null
  templateId?: string | null
  lastError?: string | null
  lastHealthyAt?: Date | null
  lastStartedAt?: Date | null
  lastStoppedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

export interface MockWorkenv {
  id: string
  name: string
  slug: string
  worktreePath: string
  runtime: WorkenvRuntime
  adapterHandle: string | null
  state: WorkenvState
  configHash: string
  config: WorkenvConfig
  runtimeState: WorkenvRuntimeState | null
  resolvedPorts: WorkenvResolvedPort[] | null
  templateId: string | null
  lastError: string | null
  lastHealthyAt: Date | null
  lastStartedAt: Date | null
  lastStoppedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function makeMockWorkenv(overrides: MockWorkenvOverrides = {}): MockWorkenv {
  const runtime = overrides.runtime ?? 'orbstack'
  const slug = overrides.slug ?? nextSlug('demo')
  const worktreePath = overrides.worktreePath ?? `/tmp/${slug}`
  const config: WorkenvConfig = overrides.config ?? { runtime, worktreePath }
  const now = overrides.createdAt ?? new Date()
  return {
    id: overrides.id ?? `we_${uuid()}`,
    name: overrides.name ?? slug,
    slug,
    worktreePath,
    runtime,
    adapterHandle: overrides.adapterHandle ?? null,
    state: overrides.state ?? 'stopped',
    configHash: overrides.configHash ?? 'h0',
    config,
    runtimeState: overrides.runtimeState ?? null,
    resolvedPorts: overrides.resolvedPorts ?? null,
    templateId: overrides.templateId ?? null,
    lastError: overrides.lastError ?? null,
    lastHealthyAt: overrides.lastHealthyAt ?? null,
    lastStartedAt: overrides.lastStartedAt ?? null,
    lastStoppedAt: overrides.lastStoppedAt ?? null,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

// ---- Template row ---------------------------------------------------------

export interface MockWorkenvTemplateOverrides {
  id?: string
  name?: string
  description?: string | null
  runtime?: WorkenvRuntime
  config?: Partial<WorkenvConfig>
  builtIn?: boolean
  sortOrder?: number
  createdAt?: Date
  updatedAt?: Date
}

export interface MockWorkenvTemplate {
  id: string
  name: string
  description: string | null
  runtime: WorkenvRuntime
  config: Partial<WorkenvConfig>
  builtIn: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export function makeMockWorkenvTemplate(overrides: MockWorkenvTemplateOverrides = {}): MockWorkenvTemplate {
  const runtime = overrides.runtime ?? 'orbstack'
  const now = overrides.createdAt ?? new Date()
  return {
    id: overrides.id ?? `wet_${uuid()}`,
    name: overrides.name ?? `Template ${slugCounter}`,
    description: overrides.description ?? null,
    runtime,
    config: overrides.config ?? { runtime },
    builtIn: overrides.builtIn ?? false,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: now,
    updatedAt: overrides.updatedAt ?? now,
  }
}

// ---- Event row ------------------------------------------------------------

export interface MockWorkenvEventOverrides {
  id?: string
  workenvId: string
  type?: WorkenvEventType
  payload?: Record<string, unknown> | null
  createdAt?: Date
}

export interface MockWorkenvEvent {
  id: string
  workenvId: string
  type: WorkenvEventType
  payload: Record<string, unknown> | null
  createdAt: Date
}

export function makeMockWorkenvEvent(overrides: MockWorkenvEventOverrides): MockWorkenvEvent {
  return {
    id: overrides.id ?? `wee_${uuid()}`,
    workenvId: overrides.workenvId,
    type: overrides.type ?? 'created',
    payload: overrides.payload ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  }
}

// ---- Bootstrap step -------------------------------------------------------

type BootstrapShellOverrides = { kind?: 'shell'; run?: string; idempotencyKey?: string }
type BootstrapScriptOverrides = { kind: 'script'; path?: string; idempotencyKey?: string }
type BootstrapHostScriptOverrides = { kind: 'hostScript'; path?: string; idempotencyKey?: string }
type BootstrapRecipeOverrides = { kind: 'recipe'; ref?: string; with?: Record<string, unknown> }

export type MockBootstrapStepOverrides =
  | BootstrapShellOverrides
  | BootstrapScriptOverrides
  | BootstrapHostScriptOverrides
  | BootstrapRecipeOverrides

export function makeMockBootstrapStep(overrides: MockBootstrapStepOverrides = {}): WorkenvBootstrapStep {
  const kind = overrides.kind ?? 'shell'
  if (kind === 'shell') {
    const o = overrides as BootstrapShellOverrides
    return {
      kind: 'shell',
      run: o.run ?? 'echo hello',
      ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
    }
  }
  if (kind === 'script') {
    const o = overrides as BootstrapScriptOverrides
    return {
      kind: 'script',
      path: o.path ?? './bootstrap.sh',
      ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
    }
  }
  if (kind === 'hostScript') {
    const o = overrides as BootstrapHostScriptOverrides
    return {
      kind: 'hostScript',
      path: o.path ?? '/Users/me/bootstrap.sh',
      ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}),
    }
  }
  const o = overrides as BootstrapRecipeOverrides
  return { kind: 'recipe', ref: o.ref ?? 'recipes/example', ...(o.with ? { with: o.with } : {}) }
}
