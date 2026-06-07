import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'

/** Events we want to hook for Claude Code status detection. */
const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Stop',
  'Notification',
  // Fires when Claude writes/edits/deletes a file. Used to instantly refresh
  // the git-status badge for that pod — the 2s poll tick is the backstop for
  // external edits (user's editor, codex, shell commands). See Claude Code
  // hook docs: https://code.claude.com/docs/en/hooks#filechanged
  'FileChanged',
]

const SETTINGS_MARKER = '__wanda_managed'

export interface ClaudeHookInjectOpts {
  /** Full URL Claude should POST hook events to (e.g. http://127.0.0.1:1234/agent-status). */
  readonly httpUrl: string
}

/**
 * Write a .claude/settings.local.json in the workspace with HTTP-type hooks
 * that POST agent status to Wanda. Returns a cleanup function that removes
 * the managed entries (preserving any user-authored content).
 *
 * Native Claude Code hook handler — no external script. Terminal identity is
 * passed via `X-Wanda-Terminal-Id` (env-substituted from `WANDA_TERMINAL_ID`,
 * which Wanda sets on the agent's PTY env at spawn time).
 */
export function injectClaudeHooks(cwd: string, opts: ClaudeHookInjectOpts): () => void {
  const settingsPath = join(cwd, '.claude', 'settings.local.json')

  let existing: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      log.pod.warn(`Failed to parse existing ${settingsPath}, overwriting`)
    }
  }

  const hooks: Record<string, unknown[]> = (existing.hooks as Record<string, unknown[]>) ?? {}

  for (const event of HOOK_EVENTS) {
    const matcherGroup = {
      matcher: '',
      hooks: [
        {
          type: 'http',
          url: opts.httpUrl,
          headers: {
            'X-Wanda-Terminal-Id': '$WANDA_TERMINAL_ID',
            'X-Wanda-Agent-Type': 'claude',
            'X-Wanda-Hook-Token': '$WANDA_HOOK_TOKEN',
          },
          allowedEnvVars: ['WANDA_TERMINAL_ID', 'WANDA_HOOK_TOKEN'],
        },
      ],
      [SETTINGS_MARKER]: true,
    }
    const eventGroups = (hooks[event] ?? []) as Record<string, unknown>[]
    const filtered = eventGroups.filter((g) => !g[SETTINGS_MARKER])
    filtered.push(matcherGroup)
    hooks[event] = filtered
  }

  existing.hooks = hooks
  mkdirSync(join(cwd, '.claude'), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
  log.pod.info(`Injected Claude Code hooks into ${settingsPath}`)

  return () => cleanupClaudeHooks(cwd)
}

/** Remove Wanda-managed hook entries from settings.local.json. */
function cleanupClaudeHooks(cwd: string) {
  const settingsPath = join(cwd, '.claude', 'settings.local.json')
  if (!existsSync(settingsPath)) return

  try {
    const existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const hooks = existing.hooks as Record<string, unknown[]> | undefined
    if (!hooks) return

    for (const event of Object.keys(hooks)) {
      const filtered = (hooks[event] as Record<string, unknown>[]).filter((h) => !h[SETTINGS_MARKER])
      if (filtered.length > 0) {
        hooks[event] = filtered
      } else {
        delete hooks[event]
      }
    }

    if (Object.keys(hooks).length === 0) {
      delete existing.hooks
    }

    const remainingKeys = Object.keys(existing)
    if (remainingKeys.length === 0) {
      writeFileSync(settingsPath, '{}\n', 'utf-8')
    } else {
      writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + '\n', 'utf-8')
    }
    log.pod.info(`Cleaned up Claude Code hooks from ${settingsPath}`)
  } catch (err) {
    log.pod.warn(`Failed to clean up Claude hooks from ${settingsPath}:`, err)
  }
}
