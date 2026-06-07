import { execSync } from 'node:child_process'
import type { AgentType } from '../../domains/pod/types'

export const AGENT_CLI: Record<AgentType, { command: string; args?: string[] }> = {
  claude: { command: 'claude' },
  codex: { command: 'codex' },
  opencode: { command: 'opencode' },
}

export const AGENT_LABELS: Record<AgentType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

/**
 * Returns the user's login-shell PATH with node_modules/.bin stripped.
 *
 * Electron apps launched from Dock/Finder inherit a minimal system PATH
 * that may not include ~/.local/bin, nvm, homebrew, etc. We resolve the
 * real PATH from the user's default shell so agent CLIs (claude, codex,
 * opencode) find the user's global installations.
 */
let _shellPath: string | null = null

export function globalBinPath(): string {
  if (_shellPath === null) {
    try {
      const shell = process.env.SHELL ?? '/bin/zsh'
      _shellPath = execSync(`${shell} -ilc 'printf "%s" "$PATH"'`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
    } catch {
      _shellPath = process.env.PATH ?? ''
    }
  }
  return _shellPath
    .split(':')
    .filter((p) => !p.includes('node_modules/.bin'))
    .join(':')
}
