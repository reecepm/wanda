import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileRuntimeMountSteps } from '../runtime-mounts'

describe('compileRuntimeMountSteps', () => {
  it('materializes OrbStack bind mounts as guest symlinks to host-shared paths', () => {
    const steps = compileRuntimeMountSteps(
      {
        runtime: 'orbstack',
        worktreePath: '/Users/alice/code/app',
        mounts: [{ kind: 'bind', host: '~/.ssh', guest: '/root/.ssh', mode: 'ro' }],
      },
      'auto-host-home',
      { hostHome: '/Users/alice' },
    )

    expect(steps).toHaveLength(1)
    const step = steps[0]!
    expect(step.kind).toBe('shell')
    if (step.kind !== 'shell') return
    expect(step.run).toContain('host=/Users/alice/.ssh')
    expect(step.run).toContain('guest=/root/.ssh')
    expect(step.run).toContain('ln -s "$host" "$guest"')
    expect(step.run).not.toContain('then;')
    const syntax = spawnSync('/bin/sh', ['-n'], { input: step.run, encoding: 'utf8' })
    expect(syntax.status).toBe(0)
    expect(step.idempotencyKey).toBeUndefined()
  })

  it('yields no steps when the runtime does not use the auto-host-home sharing model', () => {
    const steps = compileRuntimeMountSteps(
      {
        runtime: 'orbstack',
        worktreePath: '/Users/alice/code/app',
        mounts: [{ kind: 'bind', host: '~/.ssh', guest: '/root/.ssh', mode: 'ro' }],
      },
      'explicit-mounts',
      { hostHome: '/Users/alice' },
    )

    expect(steps).toEqual([])
  })

  it('deduplicates repeated mounts by materialized key', () => {
    const mount = { kind: 'bind' as const, host: '~/.gitconfig', guest: '/root/.gitconfig', mode: 'ro' as const }
    const steps = compileRuntimeMountSteps(
      {
        runtime: 'orbstack',
        worktreePath: '/Users/alice/code/app',
        mounts: [mount, mount],
      },
      'auto-host-home',
      { hostHome: '/Users/alice' },
    )

    expect(steps).toHaveLength(1)
  })

  it('creates cache mount directories without host links', () => {
    const steps = compileRuntimeMountSteps(
      {
        runtime: 'orbstack',
        worktreePath: '/Users/alice/code/app',
        mounts: [{ kind: 'cache', guest: '/cache/npm', mode: 'rw', cacheKey: 'npm' }],
      },
      'auto-host-home',
    )

    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'shell',
        run: 'mkdir -p /cache/npm',
      }),
    ])
    const step = steps[0]!
    expect(step.kind).toBe('shell')
    if (step.kind !== 'shell') return
    expect(step.idempotencyKey).toBeUndefined()
  })

  it('merges an existing guest directory into rw host mount before linking', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wanda-mount-'))
    try {
      const host = join(dir, 'host-claude')
      const guest = join(dir, 'guest-claude')
      mkdirSync(guest)
      writeFileSync(join(guest, 'settings.json'), '{"ok":true}')

      const steps = compileRuntimeMountSteps(
        {
          runtime: 'orbstack',
          worktreePath: '/Users/alice/code/app',
          mounts: [{ kind: 'bind', host, guest, mode: 'rw' }],
        },
        'auto-host-home',
      )
      const step = steps[0]!
      expect(step.kind).toBe('shell')
      if (step.kind !== 'shell') return

      const result = spawnSync('/bin/sh', ['-c', step.run], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(readlinkSync(guest)).toBe(host)
      expect(readFileSync(join(host, 'settings.json'), 'utf8')).toBe('{"ok":true}')
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })

  it('moves an existing guest directory aside before linking a ro host mount', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wanda-mount-'))
    try {
      const host = join(dir, 'host-config')
      const guest = join(dir, 'guest-config')
      mkdirSync(host)
      mkdirSync(guest)
      writeFileSync(join(host, 'token'), 'host-token')
      writeFileSync(join(guest, 'default-config'), 'guest-config')

      const steps = compileRuntimeMountSteps(
        {
          runtime: 'orbstack',
          worktreePath: '/Users/alice/code/app',
          mounts: [{ kind: 'bind', host, guest, mode: 'ro' }],
        },
        'auto-host-home',
      )
      const step = steps[0]!
      expect(step.kind).toBe('shell')
      if (step.kind !== 'shell') return

      const result = spawnSync('/bin/sh', ['-c', step.run], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      expect(readlinkSync(guest)).toBe(host)
      expect(readFileSync(join(guest, 'token'), 'utf8')).toBe('host-token')
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    }
  })
})
