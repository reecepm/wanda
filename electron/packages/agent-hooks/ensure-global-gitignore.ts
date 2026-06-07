import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { log } from '../logger'

/** Patterns that agent hooks write and should never be committed. */
const AGENT_HOOK_PATTERNS = [
  '.claude/wanda-status-hook.sh',
  '.codex/wanda-status-hook.sh',
  '.codex/hooks.json',
  '.opencode/plugins/wanda-status.ts',
]

const MARKER = '# Wanda agent hooks (auto-managed)'

/**
 * Ensure agent hook files are in the user's global gitignore.
 * Creates the file if it doesn't exist, appends if patterns are missing.
 */
export function ensureGlobalGitignore(): void {
  try {
    const ignorePath = resolveGlobalIgnorePath()
    const dir = dirname(ignorePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const existing = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf-8') : ''

    // Check if our section already exists and is up to date
    if (existing.includes(MARKER)) {
      const allPresent = AGENT_HOOK_PATTERNS.every((p) => existing.includes(p))
      if (allPresent) return
    }

    // Remove old Wanda section if present (to replace with updated one)
    const lines = existing.split('\n')
    const filtered: string[] = []
    let inOrcaSection = false
    for (const line of lines) {
      if (line.trim() === MARKER) {
        inOrcaSection = true
        continue
      }
      if (inOrcaSection && line.trim() === '') {
        inOrcaSection = false
        continue
      }
      if (inOrcaSection) continue
      filtered.push(line)
    }

    // Append our section
    const section = ['', MARKER, ...AGENT_HOOK_PATTERNS, ''].join('\n')

    const content = filtered.join('\n').trimEnd() + '\n' + section
    writeFileSync(ignorePath, content, 'utf-8')
    log.main.info(`Updated global gitignore at ${ignorePath}`)
  } catch (err) {
    log.main.warn('Failed to update global gitignore:', err)
  }
}

function resolveGlobalIgnorePath(): string {
  // Check if git has a configured excludesFile
  try {
    const configured = execFileSync('git', ['config', '--global', 'core.excludesFile'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim()
    if (configured) {
      return configured.startsWith('~') ? join(homedir(), configured.slice(1)) : configured
    }
  } catch {
    // No configured excludesFile — fall through to default
  }

  // Default location per git documentation
  return join(homedir(), '.config', 'git', 'ignore')
}
