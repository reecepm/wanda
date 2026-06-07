import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { log } from '../../packages/logger'

const execFileAsync = promisify(execFile)

export interface ResolvedRemote {
  host: 'github' | 'gitlab' | 'bitbucket' | 'other'
  owner: string
  repo: string
  url: string
}

/** Parse a git remote URL (https, ssh, git protocol) into provider + owner/repo. */
export function parseRemoteUrl(url: string): ResolvedRemote | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  // git@host:owner/repo(.git)
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?(?:[^@]+@)?([^:/]+)[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/)
  // https://host/owner/repo(.git)
  const httpsMatch = trimmed.match(/^https?:\/\/(?:[^@]+@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/)

  const match = httpsMatch ?? sshMatch
  if (!match) return null

  const [, hostRaw, owner, repo] = match
  if (!hostRaw || !owner || !repo) return null
  const hostLower = hostRaw.toLowerCase()

  const host: ResolvedRemote['host'] = hostLower.includes('github.com')
    ? 'github'
    : hostLower.includes('gitlab.com')
      ? 'gitlab'
      : hostLower.includes('bitbucket.org')
        ? 'bitbucket'
        : 'other'

  return { host, owner, repo, url: trimmed }
}

/** Public avatar URL for an org/user on a known git host. */
export function avatarUrlFor(remote: ResolvedRemote): string | null {
  switch (remote.host) {
    case 'github':
      // s=80 keeps the cached image small; rendered at 16-20px in the sidebar.
      return `https://github.com/${encodeURIComponent(remote.owner)}.png?size=80`
    case 'gitlab':
      // GitLab needs an API call to map a username to an avatar.
      return null
    case 'bitbucket':
      return `https://bitbucket.org/account/${encodeURIComponent(remote.owner)}/avatar/`
    default:
      return null
  }
}

/** Read `git remote get-url origin` (or any remote) for a repo path. */
export async function readGitRemoteUrl(repoPath: string, remote = 'origin'): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoPath, 'remote', 'get-url', remote], { timeout: 5_000 })
    const url = stdout.trim()
    return url || null
  } catch (err) {
    log.repo.debug('readGitRemoteUrl failed', {
      repoPath,
      remote,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/** Resolve an icon URL for a repo path. Returns null when no remote is known. */
export async function resolveIconUrlFromRepo(repoPath: string | null | undefined): Promise<string | null> {
  if (!repoPath) return null
  const remoteUrl = await readGitRemoteUrl(repoPath)
  if (!remoteUrl) return null
  const parsed = parseRemoteUrl(remoteUrl)
  if (!parsed) return null
  return avatarUrlFor(parsed)
}
