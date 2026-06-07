import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ChecksStatus, GitStatusPR, PRMergeable, PRState } from '../../../../shared/contracts/git-status'
import { shellEnv } from '../../../infra/shell-env'
import { log } from '../../../packages/logger'

const execFileAsync = promisify(execFile)

type PRStatus = {
  number: number
  state: string
  statusCheckRollup: { state: string }[]
  mergeable: string
  headRefName: string
  baseRefName: string
  url: string
  isDraft: boolean
  title: string
  files: { path: string; additions: number; deletions: number }[]
  additions: number
  deletions: number
  changedFiles: number
}

/**
 * Calls `gh pr view` for the current branch in `repoPath` and returns the
 * parsed JSON, or `null` if there's no PR / gh isn't available / the call
 * fails for any reason. Never throws — callers treat null as "no PR".
 */
export async function ghGetPRStatus(repoPath: string): Promise<PRStatus | null> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'view',
        '--json',
        'number,state,statusCheckRollup,mergeable,headRefName,baseRefName,url,isDraft,title,additions,deletions,changedFiles,files',
      ],
      { cwd: repoPath, timeout: 15_000, env: shellEnv() },
    )
    return JSON.parse(stdout) as PRStatus
  } catch (err) {
    // gh not installed, repo has no PR, or network down — all expected
    // states. Log at debug so this doesn't drown real errors in prod,
    // but investigators can find why PR status isn't showing up.
    log.repo.debug('gh pr view failed', { repoPath, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

/** Condense the verbose `gh pr view` payload to the shape broadcast to clients. */
export function condensePRStatus(raw: PRStatus | null): GitStatusPR | null {
  if (!raw) return null
  const rollup = raw.statusCheckRollup
  let checks: ChecksStatus = 'none'
  if (rollup?.length) {
    if (rollup.every((c) => c.state === 'SUCCESS')) checks = 'success'
    else if (rollup.some((c) => c.state === 'FAILURE' || c.state === 'ERROR')) checks = 'failure'
    else checks = 'pending'
  }
  const state: PRState = raw.state === 'MERGED' || raw.state === 'CLOSED' ? raw.state : 'OPEN'
  const mergeable: PRMergeable =
    raw.mergeable === 'CONFLICTING' ? 'CONFLICTING' : raw.mergeable === 'MERGEABLE' ? 'MERGEABLE' : 'UNKNOWN'
  return {
    number: raw.number,
    state,
    isDraft: raw.isDraft,
    mergeable,
    checks,
    url: raw.url,
    title: raw.title,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
  }
}
