import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { copyIgnoredFiles, execErrorMessage, normalizePullRequestBaseBranch } from './worktrees'

describe('copyIgnoredFiles', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function tempRoot() {
    const root = mkdtempSync(join(tmpdir(), 'wanda-worktree-copy-'))
    roots.push(root)
    return root
  }

  function initRepo(repo: string) {
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo })
    writeFileSync(join(repo, 'README.md'), 'readme\n')
    execFileSync('git', ['add', 'README.md'], { cwd: repo })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' })
  }

  it('copies root and nested .env files even when they are not reported as ignored', async () => {
    const root = tempRoot()
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(join(source, 'apps', 'api'), { recursive: true })
    await mkdir(dest, { recursive: true })
    initRepo(source)
    writeFileSync(join(source, '.env'), 'ROOT=1\n')
    writeFileSync(join(source, 'apps', 'api', '.env.local'), 'API=1\n')

    const result = await Effect.runPromise(copyIgnoredFiles(source, dest))

    expect(result.failed).toEqual([])
    expect(result.copied).toEqual(['.env', 'apps/api/.env.local'])
    expect(readFileSync(join(dest, '.env'), 'utf-8')).toBe('ROOT=1\n')
    expect(readFileSync(join(dest, 'apps', 'api', '.env.local'), 'utf-8')).toBe('API=1\n')
  })

  it('copies gitignored hidden files and skips heavy generated directories', async () => {
    const root = tempRoot()
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(join(source, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(dest, { recursive: true })
    initRepo(source)
    writeFileSync(join(source, '.gitignore'), '.env*\n.secret.local\nnode_modules/\n')
    writeFileSync(join(source, '.env'), 'ROOT=1\n')
    writeFileSync(join(source, '.secret.local'), 'SECRET=1\n')
    writeFileSync(join(source, 'node_modules', 'pkg', '.env'), 'BAD=1\n')

    const result = await Effect.runPromise(copyIgnoredFiles(source, dest))

    expect(result.failed).toEqual([])
    expect(result.copied).toEqual(['.env', '.secret.local'])
    expect(readFileSync(join(dest, '.env'), 'utf-8')).toBe('ROOT=1\n')
    expect(readFileSync(join(dest, '.secret.local'), 'utf-8')).toBe('SECRET=1\n')
  })
})

describe('execErrorMessage', () => {
  it('prefers command stderr so gh failures remain user-visible', () => {
    expect(
      execErrorMessage({
        stderr: Buffer.from('GraphQL: No commits between main and current-branch\n'),
        stdout: Buffer.from('https://example.test/ignored\n'),
        message: 'Command failed: gh pr create',
      }),
    ).toBe('GraphQL: No commits between main and current-branch')
  })

  it('falls back to stdout when a command fails without stderr', () => {
    expect(
      execErrorMessage({
        stdout: Buffer.from('pull request create failed: branch is not pushed\n'),
        message: 'Command failed: gh pr create',
      }),
    ).toBe('pull request create failed: branch is not pushed')
  })

  it('strips the generic command prefix from Error.message', () => {
    expect(execErrorMessage(new Error('Command failed: gh pr create\nmust first push the current branch'))).toBe(
      'must first push the current branch',
    )
  })
})

describe('normalizePullRequestBaseBranch', () => {
  it('converts local and remote git refs into GitHub base branch names', () => {
    expect(normalizePullRequestBaseBranch('origin/main')).toBe('main')
    expect(normalizePullRequestBaseBranch('refs/remotes/origin/main')).toBe('main')
    expect(normalizePullRequestBaseBranch('refs/heads/main')).toBe('main')
  })

  it('preserves branch path segments after the actual ref prefix', () => {
    expect(normalizePullRequestBaseBranch('origin/release/2026-05')).toBe('release/2026-05')
    expect(normalizePullRequestBaseBranch('feature/base')).toBe('feature/base')
  })

  it('treats blank input as absent', () => {
    expect(normalizePullRequestBaseBranch(undefined)).toBeUndefined()
    expect(normalizePullRequestBaseBranch('  ')).toBeUndefined()
  })
})
