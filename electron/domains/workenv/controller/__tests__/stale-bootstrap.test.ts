import { describe, expect, it } from 'vitest'
import type { WorkenvConfig } from '../../../../../shared/contracts/workenv'
import { stripStaleCompiledBootstrap, userBootstrapSteps } from '../workenv'

describe('stale compiled bootstrap filtering', () => {
  it('drops old generated layer/service bootstrap steps when layers are present', () => {
    const config: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/Users/alice/code/app',
      layers: [
        { kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' },
        {
          kind: 'service',
          id: 'service:postgres-17',
          name: 'pg',
          image: 'postgres:17',
        },
      ],
      bootstrap: [
        {
          kind: 'shell',
          run: 'docker run -d --name pg postgres:17',
          idempotencyKey: 'service:postgres-17:start',
        },
        {
          kind: 'shell',
          run: 'echo user step',
          idempotencyKey: 'user:step',
        },
      ],
    }

    expect(userBootstrapSteps(config)).toEqual([{ kind: 'shell', run: 'echo user step', idempotencyKey: 'user:step' }])
    expect(stripStaleCompiledBootstrap(config).bootstrap).toEqual([
      { kind: 'shell', run: 'echo user step', idempotencyKey: 'user:step' },
    ])
  })

  it('leaves bootstrap alone when there are no layers', () => {
    const config: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/Users/alice/code/app',
      bootstrap: [
        {
          kind: 'shell',
          run: 'docker ps',
          idempotencyKey: 'service:postgres-17:start',
        },
      ],
    }

    expect(userBootstrapSteps(config)).toEqual(config.bootstrap)
  })
})
