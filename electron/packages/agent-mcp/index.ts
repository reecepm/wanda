import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { APP_DOT_DIR, MCP_SECTION } from '../../app-config'
import type { AppDatabase } from '../../db/connection'
import { pods, settings, workspaceSettings } from '../../db/schema'

export const WANDA_MCP_POLICY_SETTING_KEY = 'agents.wandaMcp.policy'

export type WandaMcpPolicy = 'inherit' | 'include' | 'exclude'

export interface WandaMcpServerSpec {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>> & { readonly WANDA_PORT: string }
}

export function normalizeWandaMcpPolicy(value: unknown, fallback: WandaMcpPolicy): WandaMcpPolicy {
  return value === 'inherit' || value === 'include' || value === 'exclude' ? value : fallback
}

export function resolveWandaMcpPolicy(args: {
  readonly app?: string | null
  readonly workspace?: string | null
  readonly pod?: string | null
}): Exclude<WandaMcpPolicy, 'inherit'> {
  const pod = normalizeWandaMcpPolicy(args.pod, 'inherit')
  if (pod !== 'inherit') return pod
  const workspace = normalizeWandaMcpPolicy(args.workspace, 'inherit')
  if (workspace !== 'inherit') return workspace
  return normalizeWandaMcpPolicy(args.app, 'include') === 'exclude' ? 'exclude' : 'include'
}

export function resolveWandaMcpEnabledForPod(db: AppDatabase, podId: string): boolean {
  const pod = db.select().from(pods).where(eq(pods.id, podId)).get()
  if (!pod) return resolveWandaMcpEnabledForApp(db)
  const workspace =
    pod.workspaceId != null
      ? db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, pod.workspaceId)).get()
      : null
  const app = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, WANDA_MCP_POLICY_SETTING_KEY))
    .get()?.value

  return (
    resolveWandaMcpPolicy({
      app,
      workspace: workspace?.wandaMcpPolicy ?? null,
      pod: pod.wandaMcpPolicy ?? null,
    }) === 'include'
  )
}

export function resolveWandaMcpEnabledForApp(db: AppDatabase): boolean {
  const app = db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, WANDA_MCP_POLICY_SETTING_KEY))
    .get()?.value
  return resolveWandaMcpPolicy({ app }) === 'include'
}

export function getWandaMcpServerPath(): string {
  const envPath = process.env.WANDA_MCP_SERVER_PATH
  if (envPath && existsSync(envPath)) return envPath

  const distPath = resolve(process.cwd(), 'electron/mcp/dist/index.js')
  if (existsSync(distPath)) return distPath

  return resolve(process.cwd(), 'electron/mcp/index.ts')
}

export function buildWandaMcpServerSpec(port: number, serverPath = getWandaMcpServerPath()): WandaMcpServerSpec {
  const isTsSource = serverPath.endsWith('.ts')
  return {
    command: isTsSource ? 'npx' : 'node',
    args: isTsSource ? ['tsx', serverPath] : [serverPath],
    env: { WANDA_PORT: String(port) },
  }
}

export function buildClaudeMcpConfig(port: number): string {
  const spec = buildWandaMcpServerSpec(port)
  return JSON.stringify({
    mcpServers: {
      [MCP_SECTION]: {
        command: spec.command,
        args: spec.args,
        env: spec.env,
      },
    },
  })
}

export function buildClaudeMcpArgs(port: number): string[] {
  return ['--mcp-config', buildClaudeMcpConfig(port)]
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(', ')}]`
}

function tomlKeySegment(value: string): string {
  return /^[A-Za-z0-9_]+$/.test(value) ? value : tomlString(value)
}

export function buildCodexMcpArgs(port: number): string[] {
  const spec = buildWandaMcpServerSpec(port)
  const base = `mcp_servers.${tomlKeySegment(MCP_SECTION)}`
  return [
    '-c',
    `${base}.command=${tomlString(spec.command)}`,
    '-c',
    `${base}.args=${tomlArray(spec.args)}`,
    '-c',
    `${base}.enabled=true`,
    '-c',
    `${base}.env.WANDA_PORT=${tomlString(spec.env.WANDA_PORT)}`,
  ]
}

export function buildCodexMcpToml(port: number): string {
  const spec = buildWandaMcpServerSpec(port)
  return [
    `[mcp_servers.${tomlKeySegment(MCP_SECTION)}]`,
    `command = ${tomlString(spec.command)}`,
    `args = ${tomlArray(spec.args)}`,
    'enabled = true',
    '',
    `[mcp_servers.${tomlKeySegment(MCP_SECTION)}.env]`,
    `WANDA_PORT = ${tomlString(spec.env.WANDA_PORT)}`,
    '',
  ].join('\n')
}

export function buildOpenCodeConfigContent(port: number): string {
  const spec = buildWandaMcpServerSpec(port)
  return JSON.stringify({
    mcp: {
      [MCP_SECTION]: {
        type: 'local',
        command: [spec.command, ...spec.args],
        enabled: true,
        environment: spec.env,
      },
    },
  })
}

export function buildAcpWandaMcpServer(port: number): Record<string, unknown> {
  const spec = buildWandaMcpServerSpec(port)
  return {
    name: MCP_SECTION,
    command: spec.command,
    args: spec.args,
    env: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
  }
}

export function hasWandaMcpServer(servers: readonly unknown[] | undefined): boolean {
  return (servers ?? []).some((server) => {
    return (
      server != null &&
      typeof server === 'object' &&
      'name' in server &&
      (server as { name?: unknown }).name === MCP_SECTION
    )
  })
}

export function buildAgentTerminalMcpArgs(agentType: string, port: number): string[] {
  if (agentType === 'claude') return buildClaudeMcpArgs(port)
  if (agentType === 'codex') return buildCodexMcpArgs(port)
  return []
}

export function buildAgentTerminalMcpEnv(agentType: string, port: number): Record<string, string> {
  if (agentType !== 'opencode') return {}
  return {
    OPENCODE_CONFIG_CONTENT: buildOpenCodeConfigContent(port),
  }
}

export { MCP_SECTION, APP_DOT_DIR }
