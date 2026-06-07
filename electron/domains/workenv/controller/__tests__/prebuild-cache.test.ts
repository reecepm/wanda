import { describe, expect, it } from 'vitest'
import type { WorkenvConfig } from '../../../../../shared/contracts/workenv'
import { applyCompiledLayers } from '../compile-layers'
import { prebuildCacheKeyForConfig } from '../workenv'

describe('workenv prebuild cache key', () => {
  it('is stable for logically identical configs with different object key order', () => {
    const fromTemplate: WorkenvConfig = applyCompiledLayers({
      runtime: 'orbstack',
      worktreePath: '/Users/me/.wanda/prebuilds/project',
      layers: [
        {
          kind: 'base',
          id: 'base:ubuntu-24',
          image: 'ubuntu:24.04',
          arch: 'arm64',
          install: [{ run: 'echo base', idempotencyKey: 'base' }],
        },
        {
          kind: 'tool',
          id: 'tool:node',
          name: 'Node ${param.version}',
          params: { version: '24' },
          install: [{ run: 'echo node-${param.version}', idempotencyKey: 'node' }],
        },
      ],
      prebuild: [{ kind: 'shell', run: 'echo generic-prebuild', idempotencyKey: 'generic-prebuild' }],
    })

    const fromCreateFlow: WorkenvConfig = applyCompiledLayers({
      worktreePath: '/Users/me/Documents/projects/worktrees/project/pod-a',
      runtime: 'orbstack',
      layers: [
        {
          install: [{ idempotencyKey: 'base', run: 'echo base' }],
          arch: 'arm64',
          image: 'ubuntu:24.04',
          id: 'base:ubuntu-24',
          kind: 'base',
        },
        {
          install: [{ idempotencyKey: 'node', run: 'echo node-${param.version}' }],
          params: { version: '24' },
          name: 'Node ${param.version}',
          id: 'tool:node',
          kind: 'tool',
        },
      ],
      prebuild: [{ idempotencyKey: 'generic-prebuild', run: 'echo generic-prebuild', kind: 'shell' }],
    })

    expect(prebuildCacheKeyForConfig(fromCreateFlow)).toBe(prebuildCacheKeyForConfig(fromTemplate))
  })

  it('changes when template-time prebuild hooks change', () => {
    const base: WorkenvConfig = applyCompiledLayers({
      runtime: 'orbstack',
      worktreePath: '/Users/me/repo',
      layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
      prebuild: [{ kind: 'shell', run: 'echo prepare-v1' }],
    })
    const changed: WorkenvConfig = {
      ...base,
      prebuild: [{ kind: 'shell', run: 'echo prepare-v2' }],
    }

    expect(prebuildCacheKeyForConfig(changed)).not.toBe(prebuildCacheKeyForConfig(base))
  })

  it('uses a full sha256 digest for cache identity', () => {
    const config: WorkenvConfig = applyCompiledLayers({
      runtime: 'orbstack',
      worktreePath: '/Users/me/repo',
      layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
    })

    expect(prebuildCacheKeyForConfig(config)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('ignores runtime env when no prebuild hook can consume it', () => {
    const base: WorkenvConfig = applyCompiledLayers({
      runtime: 'orbstack',
      worktreePath: '/Users/me/repo',
      layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
      env: { A: '1' },
    })
    const changed: WorkenvConfig = { ...base, env: { A: '2' } }

    expect(prebuildCacheKeyForConfig(changed)).toBe(prebuildCacheKeyForConfig(base))
  })
})
