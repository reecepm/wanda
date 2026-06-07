import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'
import { ensureCodexHookScript } from './hook-script'

/** Events we want to hook for Codex status detection. */
const HOOK_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']

const SETTINGS_MARKER = '__wanda_managed'
const CONFIG_MARKER = '# Wanda managed: enable Codex lifecycle hooks'

/**
 * Write a `.codex/hooks.json` in the workspace pointing at a tiny shell
 * script that forwards each hook event to Wanda's HTTP endpoint. Returns a
 * cleanup function that removes only the Wanda-managed entries.
 *
 * Codex's hook engine (gated behind the `codex_hooks` feature, stable in
 * 0.124+) deserialises `prompt`/`agent` handler types but only the `command`
 * dispatcher is implemented — so we cannot use Claude's `type: "http"`
 * handler here, hence the script.
 */
export function injectCodexHooks(cwd: string): () => void {
  const codexDir = join(cwd, '.codex')
  const hookScriptPath = ensureCodexHookScript(codexDir)
  const settingsPath = join(codexDir, 'hooks.json')

  let existing: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      log.pod.warn(`Failed to parse existing ${settingsPath}, overwriting`)
    }
  }

  const hooks = isRecord(existing.hooks) ? existing.hooks : {}
  for (const event of HOOK_EVENTS) {
    const matcherGroup = {
      matcher: '',
      hooks: [{ type: 'command', command: hookScriptPath }],
      [SETTINGS_MARKER]: true,
    }
    const eventGroups = Array.isArray(hooks[event]) ? (hooks[event] as Record<string, unknown>[]) : []
    const filtered = eventGroups.filter((g) => !g[SETTINGS_MARKER])
    filtered.push(matcherGroup)
    hooks[event] = filtered
    delete existing[event]
  }
  existing.hooks = hooks

  mkdirSync(codexDir, { recursive: true })
  ensureCodexHooksFeature(codexDir)
  writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8')
  log.pod.info(`Injected Codex hooks into ${settingsPath}`)

  return () => cleanupCodexHooks(cwd)
}

function cleanupCodexHooks(cwd: string) {
  const settingsPath = join(cwd, '.codex', 'hooks.json')
  if (!existsSync(settingsPath)) return

  try {
    const existing = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const hooks = isRecord(existing.hooks) ? existing.hooks : {}

    for (const event of Object.keys(hooks)) {
      if (!Array.isArray(hooks[event])) continue
      const filtered = (hooks[event] as Record<string, unknown>[]).filter((g) => !g[SETTINGS_MARKER])
      if (filtered.length > 0) {
        hooks[event] = filtered
      } else {
        delete hooks[event]
      }
    }
    for (const event of HOOK_EVENTS) delete existing[event]

    if (Object.keys(hooks).length > 0) {
      existing.hooks = hooks
    } else {
      delete existing.hooks
    }

    if (Object.keys(existing).length === 0) {
      writeFileSync(settingsPath, '{}\n', 'utf-8')
    } else {
      writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf-8')
    }
    log.pod.info(`Cleaned up Codex hooks from ${settingsPath}`)
  } catch (err) {
    log.pod.warn(`Failed to clean up Codex hooks from ${settingsPath}:`, err)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function ensureCodexHooksFeature(codexDir: string): void {
  const configPath = join(codexDir, 'config.toml')
  const featureLine = 'codex_hooks = true'
  if (!existsSync(configPath)) {
    writeFileSync(configPath, `[features]\n${CONFIG_MARKER}\n${featureLine}\n`, 'utf-8')
    return
  }

  const current = readFileSync(configPath, 'utf-8')
  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(current)) return

  const featuresMatch = current.match(/^\s*\[features\]\s*$/m)
  if (!featuresMatch || featuresMatch.index === undefined) {
    writeFileSync(
      configPath,
      `${current.replace(/\s*$/, '\n\n')}[features]\n${CONFIG_MARKER}\n${featureLine}\n`,
      'utf-8',
    )
    return
  }

  const featureLineEnd = current.indexOf('\n', featuresMatch.index)
  const insertAt = featureLineEnd === -1 ? current.length : featureLineEnd + 1
  const prefix = featureLineEnd === -1 ? `${current}\n` : current.slice(0, insertAt)
  writeFileSync(
    configPath,
    `${prefix}${CONFIG_MARKER}\n${featureLine}\n${featureLineEnd === -1 ? '' : current.slice(insertAt)}`,
    'utf-8',
  )
}
