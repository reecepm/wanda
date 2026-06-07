import { execFileSync } from 'node:child_process'
import { ensureUtf8Locale } from './locale-env'

/**
 * Returns the user's login-shell PATH.
 *
 * Electron apps launched from Dock/Finder inherit a minimal system PATH
 * that may not include ~/.local/bin, nvm, homebrew, etc. We resolve the
 * real PATH from the user's default shell so external CLIs (gh, git, etc.)
 * are found correctly.
 */
let _shellPath: string | null = null

export function getShellPath(): string {
  if (_shellPath === null) {
    try {
      const shell = process.env.SHELL ?? '/bin/zsh'
      // argv form: the shell binary is invoked directly (no outer shell), so
      // a `$SHELL` value with metacharacters can't be interpreted. `$PATH` is
      // still expanded by the login shell we spawn, which is the point.
      _shellPath = execFileSync(shell, ['-ilc', 'printf "%s" "$PATH"'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
    } catch {
      _shellPath = process.env.PATH ?? ''
    }
  }
  return _shellPath
}

/** Returns an env object with the resolved shell PATH merged in. */
export function shellEnv(): NodeJS.ProcessEnv {
  return ensureUtf8Locale({ ...process.env, PATH: getShellPath() })
}
