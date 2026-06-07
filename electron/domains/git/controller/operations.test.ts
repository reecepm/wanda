import { Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it } from 'vitest'
import { DatabaseService } from '../../../infra/database'
import { GitController, GitControllerLive, type ShellExecFn } from './operations'

const SEP = '===WANDA-GIT-SECTION==='

function makeRuntime() {
  return ManagedRuntime.make(GitControllerLive.pipe(Layer.provide(Layer.succeed(DatabaseService, null as never))))
}

describe('GitController.getLocalSnapshot', () => {
  it('treats empty command output as a non-repo snapshot', async () => {
    const runtime = makeRuntime()
    const shellExec: ShellExecFn = async () => ({ stdout: '', stderr: '', exitCode: 0 })

    const snapshot = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitController
        return yield* git.getLocalSnapshot('/missing', 'main', shellExec)
      }),
    )

    expect(snapshot).toMatchObject({
      isRepo: false,
      branch: null,
      upstream: null,
      hasRemote: false,
      ahead: 0,
      behind: 0,
      hasWorkingTreeChanges: false,
      changedFileCount: 0,
    })
    await runtime.dispose()
  })

  it('recovers shell execution failures as a non-repo snapshot', async () => {
    const runtime = makeRuntime()
    const shellExec: ShellExecFn = async () => {
      throw new Error('remote shell unavailable')
    }

    const snapshot = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitController
        return yield* git.getLocalSnapshot('/repo', 'main', shellExec)
      }),
    )

    expect(snapshot.isRepo).toBe(false)
    expect(snapshot.changedFileCount).toBe(0)
    await runtime.dispose()
  })

  it('parses a valid repo snapshot and counts local changes', async () => {
    const runtime = makeRuntime()
    const stdout = [
      `${SEP}BRANCH`,
      'feature/work',
      `${SEP}UPSTREAM`,
      'origin/feature/work',
      `${SEP}REMOTES`,
      'origin',
      `${SEP}AHEAD_BEHIND`,
      '2\t3',
      `${SEP}STATUS`,
      '# branch.oid abc123',
      '1 M. N... 100644 100644 100644 abc abc tracked.ts',
      '? new file.ts',
      `${SEP}UNCOMMITTED_NUMSTAT`,
      '4\t1\ttracked.ts',
      `${SEP}MERGE_BASE`,
      'base123',
      `${SEP}BRANCH_NUMSTAT`,
      '8\t2\ttracked.ts',
      `${SEP}UNTRACKED_LINECOUNTS`,
      '5\tnew file.ts',
      `${SEP}END`,
      '',
    ].join('\n')
    const shellExec: ShellExecFn = async () => ({ stdout, stderr: '', exitCode: 0 })

    const snapshot = await runtime.runPromise(
      Effect.gen(function* () {
        const git = yield* GitController
        return yield* git.getLocalSnapshot('/repo', 'main', shellExec)
      }),
    )

    expect(snapshot).toMatchObject({
      isRepo: true,
      branch: 'feature/work',
      upstream: 'origin/feature/work',
      hasRemote: true,
      ahead: 3,
      behind: 2,
      mergeBase: 'base123',
      hasWorkingTreeChanges: true,
      changedFileCount: 2,
    })
    expect(snapshot.staged).toEqual([{ path: 'tracked.ts', status: 'modified', staged: true }])
    expect(snapshot.untracked).toEqual(['new file.ts'])
    expect(snapshot.uncommittedFiles).toEqual([
      { path: 'tracked.ts', additions: 4, deletions: 1 },
      { path: 'new file.ts', additions: 5, deletions: 0 },
    ])
    await runtime.dispose()
  })
})
