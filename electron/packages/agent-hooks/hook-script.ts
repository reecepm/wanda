import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Tiny shell script for Codex hooks. Codex only supports `type: "command"`
 * hook handlers (HTTP/MCP/agent variants exist in the schema but are dropped
 * at discovery — see codex-rs/hooks/src/engine/discovery.rs). The script
 * forwards the hook JSON Codex pipes on stdin to Wanda's HTTP endpoint.
 *
 * Wanda's PTY env supplies WANDA_HTTP_HOST, WANDA_HTTP_PORT, WANDA_TERMINAL_ID.
 * `/agent-status` accepts Codex's native payload shape and reads the terminal
 * id from the X-Wanda-Terminal-Id header.
 */
const HOOK_SCRIPT = `#!/bin/sh
# Wanda Codex status hook — forward stdin payload to Wanda HTTP endpoint.
[ -z "\${WANDA_HTTP_PORT:-}" ] && exit 0
HOST="\${WANDA_HTTP_HOST:-127.0.0.1}"
curl -sf -X POST \\
  --max-time 2 \\
  -H 'Content-Type: application/json' \\
  -H "X-Wanda-Terminal-Id: \${WANDA_TERMINAL_ID:-}" \\
  -H 'X-Wanda-Agent-Type: codex' \\
  -H "X-Wanda-Hook-Token: \${WANDA_HOOK_TOKEN:-}" \\
  --data-binary @- \\
  "http://\${HOST}:\${WANDA_HTTP_PORT}/agent-status" \\
  >/dev/null 2>&1 || true
exit 0
`

/** Write the Codex hook script and return its absolute path. */
export function ensureCodexHookScript(codexDir: string): string {
  mkdirSync(codexDir, { recursive: true })
  const scriptPath = join(codexDir, 'wanda-status-hook.sh')
  writeFileSync(scriptPath, HOOK_SCRIPT, { mode: 0o755 })
  return scriptPath
}
