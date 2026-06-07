import { describe, expect, it } from 'vitest'
import type { WorkenvConfig, WorkenvLayer } from '../../../../../shared/contracts/workenv'
import { applyCompiledLayers, compileLayerRuntimeChecks, compileLayers } from '../compile-layers'

describe('compileLayers', () => {
  it('expands a base layer into the base field', () => {
    const layers: WorkenvLayer[] = [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04', arch: 'arm64' }]
    const out = compileLayers(layers)
    expect(out.base).toEqual({ image: 'ubuntu:24.04', arch: 'arm64' })
    expect(out.bootstrap).toEqual([])
  })

  it('emits a base layer install steps as bootstrap', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'base',
        id: 'base:ubuntu-24',
        image: 'ubuntu:24.04',
        install: [{ run: 'apt-get update && apt-get install -y curl git', idempotencyKey: 'essentials' }],
      },
    ]
    const out = compileLayers(layers)
    expect(out.base?.image).toBe('ubuntu:24.04')
    expect(out.bootstrap).toHaveLength(1)
    expect(out.bootstrap[0]).toMatchObject({
      kind: 'shell',
      run: 'apt-get update && apt-get install -y curl git',
      idempotencyKey: 'essentials',
    })
  })

  it('emits an apt install step for a pkg layer', () => {
    const layers: WorkenvLayer[] = [{ kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl', 'git'] }]
    const out = compileLayers(layers)
    expect(out.bootstrap).toHaveLength(1)
    expect(out.bootstrap[0]).toMatchObject({
      kind: 'shell',
      run: 'apt-get update && apt-get install -y curl git',
      idempotencyKey: expect.stringMatching(/^pkg:common:install:/),
    })
  })

  it('interpolates ${param.X} in tool install steps', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'tool',
        id: 'tool:node',
        name: 'Node ${param.version}',
        params: { version: '22' },
        install: [{ run: 'curl -fsSL https://deb.nodesource.com/setup_${param.version}.x | bash -' }],
      },
    ]
    const out = compileLayers(layers)
    expect(out.bootstrap).toHaveLength(1)
    expect(out.bootstrap[0]).toMatchObject({
      kind: 'shell',
      run: 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -',
      idempotencyKey: expect.stringMatching(/^tool:node:install:0:/),
    })
  })

  it('auto-derived idempotency keys change when generated commands change', () => {
    const first = compileLayers([{ kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl'] }]).bootstrap[0]!
    const second = compileLayers([{ kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl', 'git'] }])
      .bootstrap[0]!

    expect(first.kind).toBe('shell')
    expect(second.kind).toBe('shell')
    if (first.kind !== 'shell' || second.kind !== 'shell') return
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey)
  })

  it('wraps asUser steps in sudo -u', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'tool',
        id: 'tool:bun',
        name: 'Bun',
        install: [{ run: 'curl -fsSL https://bun.sh/install | bash', asUser: 'dev' }],
      },
    ]
    const out = compileLayers(layers)
    expect(out.bootstrap[0]).toMatchObject({
      kind: 'shell',
      run: "sudo -u dev -i bash -lc 'curl -fsSL https://bun.sh/install | bash'",
    })
  })

  it('compiles tool verify steps as runtime checks without mixing them into install bootstrap', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'tool',
        id: 'tool:custom-cli',
        name: 'Custom CLI ${param.version}',
        params: { version: '1.2.3' },
        install: [{ run: 'install-custom-cli ${param.version}' }],
        verify: [{ run: 'custom-cli --version | grep ${param.version}' }],
      },
    ]

    const install = compileLayers(layers)
    const checks = compileLayerRuntimeChecks(layers)

    expect(install.bootstrap).toHaveLength(1)
    expect(install.bootstrap[0]).toMatchObject({
      kind: 'shell',
      run: 'install-custom-cli 1.2.3',
    })
    expect(checks).toEqual([
      expect.objectContaining({
        kind: 'shell',
        run: 'custom-cli --version | grep 1.2.3',
        idempotencyKey: undefined,
      }),
    ])
  })

  it('an auth layer contributes mounts + env + resolveEnv hooks', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'auth',
        id: 'auth:gh',
        name: 'GitHub CLI Auth',
        mounts: [{ host: '~/.config/gh', guest: '/root/.config/gh', mode: 'ro', kind: 'bind' }],
        resolveEnv: { GH_TOKEN: 'cat ~/.config/gh/hosts.yml' },
      },
    ]
    const out = compileLayers(layers)
    expect(out.mounts).toHaveLength(1)
    expect(out.env.GH_TOKEN).toEqual({ fromHost: 'cat ~/.config/gh/hosts.yml' })
  })

  it('applyCompiledLayers merges fields but leaves bootstrap to fresh-compile-at-start', () => {
    const config: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/Users/me/code/repo',
      bootstrap: [{ kind: 'shell', run: 'echo user-step' }],
      env: { NODE_ENV: 'development' },
      layers: [
        { kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' },
        { kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl'] },
      ],
    }
    const out = applyCompiledLayers(config)
    expect(out.base).toEqual({ image: 'ubuntu:24.04', arch: undefined })
    // Bootstrap is NOT merged at apply time — layer-derived steps are
    // recomputed at workenv.start so catalog improvements flow through.
    expect(out.bootstrap?.map((s) => (s.kind === 'shell' ? s.run : '?'))).toEqual(['echo user-step'])
    expect(out.env).toEqual({ NODE_ENV: 'development' })
  })

  it('service layer captures ports + env without emitting in-VM docker steps', () => {
    const layers: WorkenvLayer[] = [
      {
        kind: 'service',
        id: 'service:postgres-17',
        name: 'pg',
        image: 'postgres:17',
        ports: [{ name: 'postgres', guest: 5432, host: 'auto', protocol: 'tcp' }],
        env: { POSTGRES_USER: 'wanda' },
      },
    ]
    const out = compileLayers(layers)
    // Services run on host docker (when implemented) — not inside the VM.
    // No bootstrap step should be emitted; ports + env still surface.
    expect(out.bootstrap).toEqual([])
    expect(out.ports.find((p) => p.name === 'postgres')?.guest).toBe(5432)
    expect(out.env.POSTGRES_USER).toBe('wanda')
  })

  it('user-set base wins over a layer-supplied base', () => {
    const config: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/Users/me/code/repo',
      base: { image: 'debian:12-slim' },
      layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
    }
    const out = applyCompiledLayers(config)
    expect(out.base?.image).toBe('debian:12-slim')
  })
})
