import { describe, expect, it } from 'vitest'
import { workenvBootstrapStepSchema, workenvConfigSchema } from '../../../shared/contracts/workenv'
import {
  makeMockBootstrapStep,
  makeMockWorkenv,
  makeMockWorkenvEvent,
  makeMockWorkenvTemplate,
} from '../workenv-fixtures'

describe('makeMockWorkenv', () => {
  it('produces a row that satisfies the workenv table shape', () => {
    const w = makeMockWorkenv()
    expect(w.id).toMatch(/^we_/)
    expect(w.slug).toBe(w.slug.toLowerCase())
    expect(w.runtime).toBe('orbstack')
    expect(w.state).toBe('stopped')
    expect(w.adapterHandle).toBeNull()
    expect(workenvConfigSchema.parse(w.config)).toEqual(w.config)
  })

  it('applies overrides over defaults', () => {
    const w = makeMockWorkenv({ name: 'My Env', runtime: 'orbstack', state: 'running' })
    expect(w.name).toBe('My Env')
    expect(w.runtime).toBe('orbstack')
    expect(w.state).toBe('running')
    // Config defaults follow runtime.
    expect(w.config.runtime).toBe('orbstack')
  })

  it('generates distinct ids for repeated calls', () => {
    const a = makeMockWorkenv()
    const b = makeMockWorkenv()
    expect(a.id).not.toBe(b.id)
    expect(a.slug).not.toBe(b.slug)
  })

  it('respects an explicit config override', () => {
    const w = makeMockWorkenv({
      config: {
        runtime: 'orbstack',
        worktreePath: '/tmp/custom',
        ports: [{ name: 'web', guest: 3000, host: 'auto', protocol: 'tcp' }],
      },
    })
    expect(w.config.worktreePath).toBe('/tmp/custom')
    expect(w.config.ports?.[0]?.name).toBe('web')
  })
})

describe('makeMockWorkenvTemplate', () => {
  it('produces a row with sane defaults', () => {
    const t = makeMockWorkenvTemplate()
    expect(t.id).toMatch(/^wet_/)
    expect(t.runtime).toBe('orbstack')
    expect(t.builtIn).toBe(false)
    expect(t.config).toBeDefined()
  })

  it('applies overrides', () => {
    const t = makeMockWorkenvTemplate({ name: 'Ubuntu 24', builtIn: true, runtime: 'orbstack' })
    expect(t.name).toBe('Ubuntu 24')
    expect(t.builtIn).toBe(true)
    expect(t.runtime).toBe('orbstack')
  })
})

describe('makeMockWorkenvEvent', () => {
  it('produces a row with default type=created', () => {
    const e = makeMockWorkenvEvent({ workenvId: 'we_x' })
    expect(e.id).toMatch(/^wee_/)
    expect(e.workenvId).toBe('we_x')
    expect(e.type).toBe('created')
  })

  it('accepts a typed payload', () => {
    const e = makeMockWorkenvEvent({
      workenvId: 'we_x',
      type: 'state.changed',
      payload: { from: 'starting', to: 'running' },
    })
    expect(e.type).toBe('state.changed')
    expect(e.payload).toEqual({ from: 'starting', to: 'running' })
  })
})

describe('makeMockBootstrapStep', () => {
  it('defaults to a shell step', () => {
    const s = makeMockBootstrapStep()
    expect(s.kind).toBe('shell')
    expect(workenvBootstrapStepSchema.parse(s)).toEqual(s)
  })

  it('builds script + recipe variants', () => {
    expect(makeMockBootstrapStep({ kind: 'script', path: './x.sh' }).kind).toBe('script')
    expect(makeMockBootstrapStep({ kind: 'recipe', ref: 'recipes/pg' }).kind).toBe('recipe')
  })
})
