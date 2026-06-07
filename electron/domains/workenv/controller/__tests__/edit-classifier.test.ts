import { describe, expect, it } from 'vitest'
import type { WorkenvConfig } from '../../../../../shared/contracts/workenv'
import { classifyConfigChange } from '../edit-classifier'

const base: WorkenvConfig = {
  runtime: 'orbstack',
  worktreePath: '/Users/alice/code',
  env: { FOO: 'bar' },
  ports: [{ name: 'api', guest: 3000, host: 'auto', protocol: 'tcp' }],
  workdir: '/home/ubuntu/code',
}

describe('classifyConfigChange', () => {
  it('returns impact=live + no changedKeys when configs are identical', () => {
    const report = classifyConfigChange(base, { ...base })
    expect(report.impact).toBe('live')
    expect(report.changedKeys).toEqual([])
  })

  it('impact=restart when only env changes', () => {
    const report = classifyConfigChange(base, { ...base, env: { FOO: 'baz' } })
    expect(report.impact).toBe('restart')
    expect(report.restartKeys).toContain('env')
    expect(report.recreateKeys).toEqual([])
  })

  it('impact=restart when ports change', () => {
    const report = classifyConfigChange(base, {
      ...base,
      ports: [{ name: 'api', guest: 4000, host: 'auto', protocol: 'tcp' }],
    })
    expect(report.impact).toBe('restart')
    expect(report.restartKeys).toContain('ports')
  })

  it('impact=recreate when worktreePath changes', () => {
    const report = classifyConfigChange(base, { ...base, worktreePath: '/Users/alice/other' })
    expect(report.impact).toBe('recreate')
    expect(report.recreateKeys).toContain('worktreePath')
  })

  it('impact=recreate when resources change', () => {
    const report = classifyConfigChange(base, { ...base, resources: { cpus: 4 } })
    expect(report.impact).toBe('recreate')
    expect(report.recreateKeys).toContain('resources')
  })

  it('impact=recreate when mounts change', () => {
    const report = classifyConfigChange(base, {
      ...base,
      mounts: [{ guest: '/cache', mode: 'rw' as const, kind: 'cache' as const }],
    })
    expect(report.impact).toBe('recreate')
    expect(report.recreateKeys).toContain('mounts')
  })

  it('impact=recreate when prebuild hooks change', () => {
    const report = classifyConfigChange(base, {
      ...base,
      prebuild: [{ kind: 'shell', run: 'echo prepare-template' }],
    })
    expect(report.impact).toBe('recreate')
    expect(report.recreateKeys).toContain('prebuild')
  })

  it('recreate takes precedence when both recreate and restart keys change', () => {
    const report = classifyConfigChange(base, {
      ...base,
      env: { FOO: 'new' },
      resources: { cpus: 4 },
    })
    expect(report.impact).toBe('recreate')
    expect(report.recreateKeys).toContain('resources')
    expect(report.restartKeys).toContain('env')
  })

  it('deep-compares nested env maps (no false positive)', () => {
    const a: WorkenvConfig = { ...base, env: { FOO: 'bar', NODE_ENV: 'production' } }
    const b: WorkenvConfig = { ...base, env: { NODE_ENV: 'production', FOO: 'bar' } }
    const report = classifyConfigChange(a, b)
    expect(report.changedKeys).toEqual([])
  })

  it('deep-compares arrays — reordered ports reported as changed', () => {
    const a: WorkenvConfig = {
      ...base,
      ports: [
        { name: 'api', guest: 3000, host: 'auto' as const, protocol: 'tcp' as const },
        { name: 'db', guest: 5432, host: 'auto' as const, protocol: 'tcp' as const },
      ],
    }
    const b: WorkenvConfig = {
      ...base,
      ports: [
        { name: 'db', guest: 5432, host: 'auto' as const, protocol: 'tcp' as const },
        { name: 'api', guest: 3000, host: 'auto' as const, protocol: 'tcp' as const },
      ],
    }
    const report = classifyConfigChange(a, b)
    expect(report.changedKeys).toContain('ports')
  })
})
