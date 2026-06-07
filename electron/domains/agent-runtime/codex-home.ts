import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { APP_DOT_DIR } from '../../app-config'
import { buildCodexMcpToml } from '../../packages/agent-mcp'

const USER_CODEX_AUTH = join(os.homedir(), '.codex', 'auth.json')
const DIRECT_CODEX_HOME_BASE = join(APP_DOT_DIR, 'codex-ui-agent')

interface LoggerLike {
  warn: (...args: unknown[]) => void
  debug?: (...args: unknown[]) => void
}

interface DirectCodexHomeOptions {
  readonly scopeId?: string
  readonly includeWandaMcp?: boolean
  readonly mcpPort?: number
}

function sanitizeScopeId(scopeId: string): string {
  return scopeId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'default'
}

export function ensureDirectCodexHome(logger?: LoggerLike, opts: DirectCodexHomeOptions = {}): string {
  const home = opts.scopeId ? join(DIRECT_CODEX_HOME_BASE, sanitizeScopeId(opts.scopeId)) : DIRECT_CODEX_HOME_BASE
  const configPath = join(home, 'config.toml')
  const authPath = join(home, 'auth.json')

  mkdirSync(home, { recursive: true })
  writeFileSync(
    configPath,
    [
      '# Managed by Wanda.',
      '# Keep this CODEX_HOME isolated from user ~/.codex/config.toml so stale MCP',
      '# server entries cannot recursively launch another Wanda instance.',
      opts.includeWandaMcp === true && opts.mcpPort != null ? buildCodexMcpToml(opts.mcpPort) : '',
      '',
    ].join('\n'),
  )

  if (existsSync(USER_CODEX_AUTH)) {
    try {
      const stat = lstatSync(authPath)
      if (stat.isSymbolicLink() || stat.isFile()) unlinkSync(authPath)
    } catch {
      /* no existing scoped auth */
    }
    try {
      symlinkSync(USER_CODEX_AUTH, authPath)
    } catch (err) {
      logger?.warn(`failed to symlink codex auth (${USER_CODEX_AUTH} -> ${authPath}); login may be required:`, err)
    }
  }

  logger?.debug?.(`direct Codex CODEX_HOME ready at ${home}`)
  return home
}
