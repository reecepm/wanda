import { describe, expect, expectTypeOf, it } from 'vitest'
import type { AppEventArgs, AppEventEnvelope, AppEvents } from '../events'
import {
  type WorkenvBootstrapStep,
  type WorkenvConfig,
  type WorkenvEventType,
  type WorkenvRuntime,
  type WorkenvState,
  workenvBootstrapStepSchema,
  workenvConfigSchema,
  workenvEnvValueSchema,
  workenvEventTypeSchema,
  workenvMountSchema,
  workenvPortSchema,
  workenvResolvedPortSchema,
  workenvRuntimeSchema,
  workenvStateSchema,
} from '../workenv'
import { type WorkenvRuntimeState, workenvRuntimeStateSchema } from '../workenv-runtime-state'

describe('workenv runtime enum', () => {
  it('accepts orbstack', () => {
    expect(workenvRuntimeSchema.parse('orbstack')).toBe('orbstack')
  })

  it('rejects unknown runtimes', () => {
    expect(workenvRuntimeSchema.safeParse('docker').success).toBe(false)
    expect(workenvRuntimeSchema.safeParse('colima').success).toBe(false)
  })
})

describe('workenv state enum', () => {
  const validStates: WorkenvState[] = [
    'creating',
    'stopped',
    'starting',
    'running',
    'stopping',
    'destroyed',
    'error',
    'stranded',
  ]

  it.each(validStates)('accepts %s', (state) => {
    expect(workenvStateSchema.parse(state)).toBe(state)
  })

  it('rejects unknown states', () => {
    expect(workenvStateSchema.safeParse('paused').success).toBe(false)
  })

  it('exposes all eight lifecycle states', () => {
    expect(workenvStateSchema.options.sort()).toEqual([...validStates].sort())
  })
})

describe('workenv config — minimum viable input', () => {
  it('parses with only { runtime, worktreePath }', () => {
    const parsed = workenvConfigSchema.parse({ runtime: 'orbstack', worktreePath: '/tmp/repo' })
    expect(parsed.runtime).toBe('orbstack')
    expect(parsed.worktreePath).toBe('/tmp/repo')
  })

  it('rejects missing runtime', () => {
    expect(workenvConfigSchema.safeParse({ worktreePath: '/tmp/repo' }).success).toBe(false)
  })

  it('rejects empty worktreePath', () => {
    expect(workenvConfigSchema.safeParse({ runtime: 'orbstack', worktreePath: '' }).success).toBe(false)
  })

  it('round-trips a fully-populated config through JSON', () => {
    const config: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/Users/me/code/repo',
      extends: ['base/ubuntu'],
      base: { image: 'ubuntu:24.04', arch: 'arm64' },
      resources: { cpus: 4, memoryMB: 8192, diskGB: 60 },
      mounts: [{ host: '/Users/me/code/repo', guest: '/work', mode: 'rw', kind: 'bind' }],
      ports: [
        { name: 'web', guest: 3000, host: 'auto', protocol: 'tcp' },
        { name: 'pg', guest: 5432, host: 5433, protocol: 'tcp' },
      ],
      env: {
        NODE_ENV: 'development',
        SECRET_KEY: { fromSecret: 'env/secret-key' },
        HOME_PATH: { fromHost: 'HOME' },
      },
      bootstrap: [
        { kind: 'shell', run: 'bun install' },
        { kind: 'script', path: './bootstrap.sh', idempotencyKey: 'bootstrap-v1' },
        { kind: 'recipe', ref: 'recipes/postgres', with: { version: '16' } },
      ],
      prebuild: [
        {
          kind: 'shell',
          label: 'Prepare reusable image state',
          run: 'task prebuild',
          cwd: `$${'{WANDA_WORKTREE_PATH}'}`,
        },
      ],
      postStart: [
        {
          kind: 'hostScript',
          label: 'Seed dev database',
          path: '/Users/me/.wanda/scripts/seed-dev.sh',
          cwd: `$${'{WANDA_WORKTREE_PATH}'}/platform`,
          asUser: 'dev',
          skipWhenPrebuilt: true,
        },
      ],
      workdir: '/work',
      healthcheck: { cmd: 'curl -f http://localhost:3000', intervalSec: 30, startPeriodSec: 5 },
      requires: ['compose', 'snapshot'],
    }
    const encoded = JSON.stringify(config)
    const decoded = workenvConfigSchema.parse(JSON.parse(encoded))
    expect(decoded).toEqual(config)
  })

  it('accepts tool layers with runtime verify steps', () => {
    const parsed = workenvConfigSchema.parse({
      runtime: 'orbstack',
      worktreePath: '/Users/me/code/repo',
      layers: [
        {
          kind: 'tool',
          id: 'tool:custom-cli',
          name: 'Custom CLI',
          install: [{ run: 'install-custom-cli' }],
          verify: [{ run: 'custom-cli --version' }],
        },
      ],
    })
    expect(parsed.layers?.[0]).toMatchObject({
      kind: 'tool',
      verify: [{ run: 'custom-cli --version' }],
    })
  })
})

describe('workenv bootstrap step (discriminated union)', () => {
  it('accepts shell variant', () => {
    const step: WorkenvBootstrapStep = {
      kind: 'shell',
      label: 'Say hi',
      run: 'echo hi',
      cwd: '/work',
      asUser: 'dev',
      idempotencyKey: 'say-hi-v1',
    }
    expect(workenvBootstrapStepSchema.parse(step)).toEqual(step)
  })

  it('accepts script variant', () => {
    expect(
      workenvBootstrapStepSchema.parse({
        kind: 'script',
        path: './x.sh',
        label: 'Run script',
        cwd: '/work',
        asUser: 'dev',
      }).kind,
    ).toBe('script')
  })

  it('accepts hostScript variant', () => {
    expect(
      workenvBootstrapStepSchema.parse({
        kind: 'hostScript',
        path: '/Users/me/bootstrap.sh',
        label: 'Run host script',
        cwd: '/work',
        asUser: 'dev',
      }).kind,
    ).toBe('hostScript')
  })

  it('accepts recipe variant', () => {
    expect(workenvBootstrapStepSchema.parse({ kind: 'recipe', ref: 'r/x' }).kind).toBe('recipe')
  })

  it('rejects unknown kind', () => {
    expect(workenvBootstrapStepSchema.safeParse({ kind: 'docker', image: 'x' }).success).toBe(false)
  })

  it('rejects shell variant without `run`', () => {
    expect(workenvBootstrapStepSchema.safeParse({ kind: 'shell' }).success).toBe(false)
  })
})

describe('workenv port', () => {
  it('accepts host as integer or "auto"', () => {
    expect(workenvPortSchema.parse({ name: 'web', guest: 80, host: 8080, protocol: 'tcp' }).host).toBe(8080)
    expect(workenvPortSchema.parse({ name: 'web', guest: 80, host: 'auto', protocol: 'tcp' }).host).toBe('auto')
  })

  it('rejects non-positive guest ports', () => {
    expect(workenvPortSchema.safeParse({ name: 'x', guest: 0, host: 'auto', protocol: 'tcp' }).success).toBe(false)
    expect(workenvPortSchema.safeParse({ name: 'x', guest: -1, host: 'auto', protocol: 'tcp' }).success).toBe(false)
  })

  it('rejects empty port name', () => {
    expect(workenvPortSchema.safeParse({ name: '', guest: 80, host: 'auto', protocol: 'tcp' }).success).toBe(false)
  })
})

describe('workenv mount', () => {
  it('accepts bind and cache kinds', () => {
    expect(workenvMountSchema.parse({ guest: '/x', mode: 'rw', kind: 'bind' }).kind).toBe('bind')
    expect(workenvMountSchema.parse({ guest: '/x', mode: 'ro', kind: 'cache', cacheKey: 'pkg-cache' }).kind).toBe(
      'cache',
    )
  })
})

describe('workenv env value', () => {
  it('accepts plain strings', () => {
    expect(workenvEnvValueSchema.parse('value')).toBe('value')
  })

  it('accepts {fromSecret} and {fromHost} variants', () => {
    expect(workenvEnvValueSchema.parse({ fromSecret: 'k' })).toEqual({ fromSecret: 'k' })
    expect(workenvEnvValueSchema.parse({ fromHost: 'HOME' })).toEqual({ fromHost: 'HOME' })
  })
})

describe('workenv resolved port', () => {
  it('parses a resolved port (host always numeric)', () => {
    expect(workenvResolvedPortSchema.parse({ name: 'web', guest: 3000, host: 41234, protocol: 'tcp' }).host).toBe(41234)
  })
})

describe('workenv runtime state (discriminated)', () => {
  it('parses orbstack state', () => {
    const state: WorkenvRuntimeState = { runtime: 'orbstack', vmName: 'wanda-x', arch: 'arm64' }
    expect(workenvRuntimeStateSchema.parse(state)).toEqual(state)
  })

  it('parses orbstack state cloned from a prebuild', () => {
    const state: WorkenvRuntimeState = {
      runtime: 'orbstack',
      vmName: 'wanda-x',
      arch: 'arm64',
      prebuildHash: 'abc123',
    }
    expect(workenvRuntimeStateSchema.parse(state)).toEqual(state)
  })

  it('rejects unknown runtime', () => {
    expect(workenvRuntimeStateSchema.safeParse({ runtime: 'bogus', vmName: 'x', arch: 'arm64' }).success).toBe(false)
  })
})

describe('workenv event types', () => {
  it('parses every event type the controller will emit', () => {
    const types: WorkenvEventType[] = [
      'created',
      'destroyed',
      'state.changed',
      'bootstrap.started',
      'bootstrap.step.started',
      'bootstrap.step.completed',
      'bootstrap.step.failed',
      'bootstrap.completed',
      'health.ok',
      'health.failed',
      'ports.changed',
      'error',
    ]
    for (const t of types) expect(workenvEventTypeSchema.parse(t)).toBe(t)
  })
})

describe('app event channel additions', () => {
  // These are compile-time checks: if the channels are missing or have wrong
  // tuples, the test file won't typecheck.

  it('declares workenv.state.changed with [id, from, to]', () => {
    expectTypeOf<AppEventArgs<'workenv.state.changed'>>().toEqualTypeOf<[string, WorkenvState, WorkenvState]>()
  })

  it('declares workenv.bootstrap.progress with [id, stepIndex, stepName, status]', () => {
    expectTypeOf<AppEventArgs<'workenv.bootstrap.progress'>>().toEqualTypeOf<
      [string, number, string, 'started' | 'succeeded' | 'failed']
    >()
  })

  it('declares workenv.health, workenv.ports.changed, workenv.event.added', () => {
    expectTypeOf<AppEventArgs<'workenv.health'>>().toEqualTypeOf<[string, boolean]>()
    expectTypeOf<AppEventArgs<'workenv.ports.changed'>>().toEqualTypeOf<[string]>()
    expectTypeOf<AppEventArgs<'workenv.event.added'>>().toEqualTypeOf<[string, WorkenvEventType]>()
  })

  it('declares workenv prebuild progress/log channels', () => {
    expectTypeOf<AppEventArgs<'workenv.prebuild.progress'>>().toEqualTypeOf<
      [string, string, number, string, 'started' | 'succeeded' | 'failed']
    >()
    expectTypeOf<AppEventArgs<'workenv.prebuild.log'>>().toEqualTypeOf<[string, string, string]>()
  })

  it('declares workenv.created / updated / destroyed with [id]', () => {
    expectTypeOf<AppEventArgs<'workenv.created'>>().toEqualTypeOf<[string]>()
    expectTypeOf<AppEventArgs<'workenv.updated'>>().toEqualTypeOf<[string]>()
    expectTypeOf<AppEventArgs<'workenv.destroyed'>>().toEqualTypeOf<[string]>()
  })

  it('round-trips a workenv.state.changed envelope through JSON', () => {
    const env: AppEventEnvelope<'workenv.state.changed'> = {
      v: 1,
      channel: 'workenv.state.changed',
      args: ['w1', 'starting', 'running'],
    }
    const decoded = JSON.parse(JSON.stringify(env)) as AppEventEnvelope<'workenv.state.changed'>
    expect(decoded.channel).toBe('workenv.state.changed')
    expect(decoded.args[0]).toBe('w1')
    expect(workenvStateSchema.parse(decoded.args[1])).toBe('starting')
    expect(workenvStateSchema.parse(decoded.args[2])).toBe('running')
  })

  it('keeps every workenv.* channel in AppEvents', () => {
    type ExpectedChannel =
      | 'workenv.created'
      | 'workenv.updated'
      | 'workenv.destroyed'
      | 'workenv.state.changed'
      | 'workenv.bootstrap.progress'
      | 'workenv.health'
      | 'workenv.event.added'
      | 'workenv.ports.changed'
    expectTypeOf<ExpectedChannel>().toExtend<keyof AppEvents>()
  })

  it('runtime values are derivable from schema', () => {
    expectTypeOf<WorkenvRuntime>().toEqualTypeOf<'orbstack'>()
  })
})
