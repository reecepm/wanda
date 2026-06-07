import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../logger'

const PLUGIN_FILENAME = 'wanda-status.ts'

/**
 * OpenCode plugin that reports agent status events to Wanda via HTTP POST.
 * Uses ESM named export format required by OpenCode's plugin system.
 */
// Build the plugin source as an array of lines to prevent the bundler
// from treating template-literal import statements as real imports.
const PLUGIN_LINES = [
  'import { readFileSync, statSync } from "fs"',
  'import { homedir } from "os"',
  'import { join } from "path"',
  'import http from "http"',
]
const PLUGIN_SCRIPT =
  PLUGIN_LINES.join('\n') +
  `

function getPort() {
  const envFile = process.env.WANDA_PORT_FILE
  if (envFile) {
    try { return readFileSync(envFile, "utf-8").trim() } catch {}
  }
  const f1 = join(homedir(), ".wanda", "mcp-port")
  const f2 = join(homedir(), ".wanda-dev", "mcp-port")
  let best: string | null = null
  let bestMtime = 0
  for (const p of [f1, f2]) {
    try {
      const m = statSync(p).mtimeMs
      if (m > bestMtime) { bestMtime = m; best = p }
    } catch {}
  }
  if (best) {
    try { return readFileSync(best, "utf-8").trim() } catch {}
  }
  return process.env.WANDA_HTTP_PORT || null
}

function post(event: string, extra?: Record<string, string | undefined>) {
  const port = getPort()
  if (!port) return
  const host = process.env.WANDA_HTTP_HOST || "127.0.0.1"
  const body = JSON.stringify({
    terminalId: process.env.WANDA_TERMINAL_ID || undefined,
    sessionId: extra?.sessionId,
    cwd: extra?.cwd || process.cwd(),
    event,
    agentType: process.env.WANDA_AGENT_TYPE || "opencode",
    toolName: extra?.toolName,
    toolCommand: extra?.toolCommand,
    timestamp: Date.now() / 1000,
  })
  try {
    const req = http.request({
      hostname: host, port: Number(port), path: "/agent-status", method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "X-Wanda-Hook-Token": process.env.WANDA_HOOK_TOKEN || "",
      },
    })
    req.on("error", () => {})
    req.end(body)
  } catch {}
}

// OpenCode's plugin runtime passes a loosely-typed context object at load
// time. Our dependency on it is narrow (project path + directory fallback),
// so we describe only what we touch rather than pulling in the full plugin
// types.
interface WandaStatusCtx {
  project?: { path?: string }
  directory?: string
}

interface OpencodeEvent {
  type: string
  properties?: Record<string, unknown>
}

export const WandaStatus = async (ctx: WandaStatusCtx) => {
  const cwd = ctx?.project?.path || ctx?.directory || process.cwd()

  return {
    event: async ({ event }: { event: OpencodeEvent }) => {
      const t = event.type
      const p = event.properties || {}

      if (t === "session.created") {
        post("SessionStart", { cwd, sessionId: p.sessionID })
      } else if (t === "session.status") {
        const status = p.status?.type
        if (status === "busy") post("working", { cwd, sessionId: p.sessionID })
        else if (status === "idle") post("idle", { cwd, sessionId: p.sessionID })
        else if (status === "error") post("error", { cwd, sessionId: p.sessionID })
      } else if (t === "session.error") {
        post("error", { cwd, sessionId: p.sessionID })
      } else if (t === "permission.asked") {
        post("PermissionRequest", {
          cwd,
          sessionId: p.sessionID,
          toolName: p.permission,
          toolCommand: (p.patterns || []).join(", "),
        })
      }
    },
  }
}
`

/**
 * Write an Wanda status plugin into .opencode/plugins/ in the workspace.
 * Returns a cleanup function that removes the plugin file.
 */
export function injectOpenCodePlugin(cwd: string): () => void {
  const pluginDir = join(cwd, '.opencode', 'plugins')
  const pluginPath = join(pluginDir, PLUGIN_FILENAME)

  mkdirSync(pluginDir, { recursive: true })
  writeFileSync(pluginPath, PLUGIN_SCRIPT, 'utf-8')

  // Ensure the plugin is registered in opencode.json (merges with existing config)
  const configPath = join(cwd, 'opencode.json')
  let config: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) {
      log.pod.warn(`opencode.json parse failed, starting with empty config`, { configPath, err })
    }
  }
  const pluginRef = `./.opencode/plugins/${PLUGIN_FILENAME}`
  const plugins = (config.plugin ?? []) as (string | unknown[])[]
  if (!plugins.some((p) => (typeof p === 'string' ? p : p[0]) === pluginRef)) {
    plugins.push(pluginRef)
    config.plugin = plugins
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  }

  log.pod.info(`Injected OpenCode plugin into ${pluginPath}`)

  return () => {
    try {
      if (existsSync(pluginPath)) {
        unlinkSync(pluginPath)
      }
      // Remove plugin ref from opencode.json
      if (existsSync(configPath)) {
        try {
          const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
          if (Array.isArray(cfg.plugin)) {
            cfg.plugin = (cfg.plugin as (string | unknown[])[]).filter(
              (p) => (typeof p === 'string' ? p : p[0]) !== pluginRef,
            )
            if (cfg.plugin.length === 0) delete cfg.plugin
            writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
          }
        } catch (err) {
          log.pod.warn(`opencode.json cleanup parse failed`, { configPath, err })
        }
      }
      log.pod.info(`Cleaned up OpenCode plugin from ${pluginPath}`)
    } catch (err) {
      log.pod.warn(`Failed to clean up OpenCode plugin from ${pluginPath}:`, err)
    }
  }
}
