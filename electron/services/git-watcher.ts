import fs from 'node:fs'
import path from 'node:path'
import { type FSWatcher, watch } from 'chokidar'

/**
 * Watches `.git` internals and fires a callback when git state may have
 * changed. Debounces rapid bursts (rebases, checkouts) into a single fire
 * per repo.
 *
 * Picks up: commits, checkouts, merges, fetches, stages (anything that
 * mutates `.git/index`, HEAD, or refs). Raw editor saves do NOT move the
 * index, so the badge won't tick until `git add` / commit / explicit
 * refresh — a deliberate trade to avoid a recursive worktree watcher that
 * leaks virtual memory on macOS fsevents with large repos.
 */
export class GitWatcher {
  private gitWatchers = new Map<string, FSWatcher>()
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private onChange: (repoPath: string) => void

  constructor(onChange: (repoPath: string) => void) {
    this.onChange = onChange
  }

  watch(repoPath: string) {
    if (this.gitWatchers.has(repoPath)) return

    const gitDir = path.join(repoPath, '.git')

    // For worktrees, .git is a file pointing to the real git dir
    let resolvedGitDir = gitDir
    try {
      const stat = fs.statSync(gitDir)
      if (stat.isFile()) {
        const content = fs.readFileSync(gitDir, 'utf-8').trim()
        const match = content.match(/^gitdir:\s*(.+)$/)
        if (match?.[1]) {
          resolvedGitDir = path.resolve(repoPath, match[1])
        }
      }
    } catch {
      return
    }

    const gitTargets = [
      path.join(resolvedGitDir, 'HEAD'),
      path.join(resolvedGitDir, 'index'),
      path.join(resolvedGitDir, 'refs'),
      path.join(resolvedGitDir, 'MERGE_HEAD'),
      path.join(resolvedGitDir, 'REBASE_MERGE'),
    ]

    const gitWatcher = watch(gitTargets, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    })
    gitWatcher.on('all', () => this.schedule(repoPath))
    this.gitWatchers.set(repoPath, gitWatcher)
  }

  private schedule(repoPath: string) {
    const existing = this.debounceTimers.get(repoPath)
    if (existing) clearTimeout(existing)
    this.debounceTimers.set(
      repoPath,
      setTimeout(() => {
        this.debounceTimers.delete(repoPath)
        this.onChange(repoPath)
      }, 300),
    )
  }

  unwatch(repoPath: string) {
    const git = this.gitWatchers.get(repoPath)
    if (git) {
      git.close()
      this.gitWatchers.delete(repoPath)
    }
    const timer = this.debounceTimers.get(repoPath)
    if (timer) {
      clearTimeout(timer)
      this.debounceTimers.delete(repoPath)
    }
  }

  async cleanup() {
    for (const repoPath of this.gitWatchers.keys()) {
      this.unwatch(repoPath)
    }
  }
}
