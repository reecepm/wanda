import { ORPCError } from '@orpc/client'
import type { ProviderId } from '@wanda/agent-protocol'
import { AgentRuntime } from '@wanda/agent-runtime'
import { Effect } from 'effect'
import { z } from 'zod'
import { CONTAINER_PREFIX } from '../../app-config'
import {
  addCommandSchema,
  addTerminalSchema,
  createPodSchema,
  importCommandsSchema,
  updateCommandSchema,
  updatePodSchema,
  updateTerminalSchema,
} from '../../domains/pod/schemas'
import { injectClaudeHooks } from '../../packages/agent-hooks/inject-claude'
import { injectCodexHooks } from '../../packages/agent-hooks/inject-codex'
import { injectOpenCodePlugin } from '../../packages/agent-hooks/inject-opencode'
import { buildAcpWandaMcpServer } from '../../packages/agent-mcp'
import { log } from '../../packages/logger'
import {
  CommandParserService,
  getPodRuntime,
  PodController,
  PodCrudController,
  PodItemController,
  ViewController,
  WorkspaceController,
} from '../../services'
import type { AppRouterDeps } from '../index'
import { extractAppIconDataUrl } from './app-icon'

/**
 * Resolve the Zed CLI binary. Electron child processes don't inherit the
 * user's shell PATH (no zshrc, no Homebrew paths), so shelling out to bare
 * `zed` usually fails even when it works in a terminal. Each Zed .app bundle
 * ships a CLI at Contents/MacOS/cli — find whichever variant is installed.
 */
let cachedZedCli: string | undefined
const probeZedCli = (path: string) =>
  Effect.tryPromise(async () => {
    const { access } = await import('node:fs/promises')
    await access(path)
    return path
  })
const resolveZedCli = Effect.gen(function* () {
  if (cachedZedCli !== undefined) return cachedZedCli
  const resolved =
    process.platform === 'darwin'
      ? yield* probeZedCli('/Applications/Zed.app/Contents/MacOS/cli').pipe(
          Effect.orElse(() => probeZedCli('/Applications/Zed Preview.app/Contents/MacOS/cli')),
          Effect.orElse(() => probeZedCli('/Applications/Zed Dev.app/Contents/MacOS/cli')),
          Effect.orElse(() => Effect.succeed('zed')),
        )
      : 'zed'
  cachedZedCli = resolved
  return resolved
})

export function podRoutes({ effectOs, orpc }: AppRouterDeps) {
  return {
    list: effectOs.input(z.object({ workspaceId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listByWorkspace(input.workspaceId)
    }),

    /**
     * Pods currently attached to the given workenv. Used by the workenv
     * destroy dialog to offer per-pod detach-vs-delete choices, and by the
     * workenv detail page's attached-pods panel.
     */
    listByWorkenv: effectOs.input(z.object({ workenvId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listByWorkenv(input.workenvId)
    }),

    /**
     * Cross-workspace pod count by status. Used by the Electron shell's tray
     * badge in subprocess mode, where the shell has no direct DB access.
     */
    countByStatus: effectOs
      .input(z.object({ status: z.enum(['stopped', 'starting', 'running', 'stopping', 'failed']) }))
      .effect(function* ({ input }) {
        const svc = yield* PodController
        return yield* svc.countByStatus(input.status)
      }),

    getById: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.getById(input.id)
    }),

    create: effectOs.input(createPodSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.create(input)
    }),

    update: effectOs.input(updatePodSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      const { id, ...data } = input
      return yield* svc.update(id, data)
    }),

    /**
     * Attach a workenv to a pod. Pod terminals routed via WE-30 will then
     * exec inside the workenv VM rather than against the host. Setting
     * workenvId is non-blocking: the pod doesn't have to be stopped first
     * (the binding takes effect on the next start/restart).
     */
    setWorkenv: effectOs.input(z.object({ id: z.string(), workenvId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.setWorkenv(input.id, input.workenvId)
    }),

    /** Detach the workenv from a pod (workenv keeps running). */
    unsetWorkenv: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.setWorkenv(input.id, null)
    }),

    delete: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.delete(input.id)
    }),

    duplicate: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.duplicate(input.id)
    }),

    start: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.start(input.id).pipe(
        Effect.tapError((e) =>
          Effect.sync(() => {
            // eslint-disable-next-line no-console
            console.error(`[pod-router] start(${input.id}) failed:`, e)
          }),
        ),
        Effect.mapError((e) => new ORPCError('INTERNAL_SERVER_ERROR', { message: e.message, cause: e })),
      )
    }),

    ensureStarted: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.ensureStarted(input.id).pipe(
        Effect.tapError((e) =>
          Effect.sync(() => {
            // eslint-disable-next-line no-console
            console.error(`[pod-router] ensureStarted(${input.id}) failed:`, e)
          }),
        ),
        Effect.mapError((e) => new ORPCError('INTERNAL_SERVER_ERROR', { message: e.message, cause: e })),
      )
    }),

    ensureAllLocalStarted: effectOs.effect(function* () {
      const svc = yield* PodController
      return yield* svc.ensureAllLocalStarted()
    }),

    stop: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.stop(input.id)
    }),

    restart: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.restart(input.id)
    }),

    stopAll: effectOs.effect(function* () {
      const svc = yield* PodController
      const stopped = yield* svc.stopAll()
      return { stopped }
    }),

    addTerminal: effectOs.input(addTerminalSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.addTerminal(input)
    }),

    updateTerminal: effectOs.input(updateTerminalSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      const { id, ...data } = input
      return yield* svc.updateTerminal(id, data)
    }),

    removeTerminal: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.removeTerminal(input.id)
    }),

    listTerminals: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listTerminals(input.podId)
    }),

    runningTerminals: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.runningTerminals(input.id)
    }),

    startTerminal: effectOs.input(z.object({ podTerminalId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.startTerminal(input.podTerminalId)
    }),

    // --- Agent routes ---

    addAgent: effectOs
      .input(
        z.object({
          podId: z.string(),
          name: z.string(),
          agentType: z.enum(['claude', 'codex', 'opencode']),
        }),
      )
      .effect(function* ({ input }) {
        const svc = yield* PodController
        return yield* svc.addAgent(input)
      }),

    removeAgent: effectOs.input(z.object({ podAgentId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.removeAgent(input.podAgentId)
    }),

    /**
     * Create a UI-centric agent session and a pod item that renders it.
     *
     * Unlike `addAgent` (which spawns a PTY-based CLI), this path creates a
     * structured session backed by `@wanda/agent-runtime` and a pod item with
     * `contentType: 'agent-session'` whose config points at the session id.
     */
    addAgentSession: effectOs
      .input(
        z.object({
          podId: z.string(),
          providerId: z.string().min(1).default('mock'),
          label: z.string().min(1).default('Agent'),
        }),
      )
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) {
          throw new ORPCError('NOT_FOUND', { message: `Pod ${input.podId} not found` })
        }

        const runtime = yield* AgentRuntime
        const httpPort = podSvc.getHttpPort()
        const includeWandaMcp = httpPort != null && (yield* podSvc.isWandaMcpEnabled(input.podId))
        const mcpServers = includeWandaMcp && httpPort != null ? [buildAcpWandaMcpServer(httpPort)] : []
        const session = yield* runtime
          .create({
            providerId: input.providerId as ProviderId,
            cwd: pod.cwd || '/',
            workspaceId: pod.workspaceId ?? null,
            mcpServers,
          })
          .pipe(
            Effect.tapError((e) =>
              Effect.sync(() => {
                // Without this log, `runtime.create` failures (provider
                // spawn failed, handshake failed, threadId missing, etc.)
                // disappear behind a generic "Internal Server Error" on
                // the client.
                // eslint-disable-next-line no-console
                console.error(`[pod-router] addAgentSession(provider=${input.providerId}) runtime.create failed:`, e)
              }),
            ),
            Effect.mapError((e) => new ORPCError('INTERNAL_SERVER_ERROR', { message: e.message, cause: e })),
          )

        const items = yield* PodItemController
        const item = yield* items.create({
          podId: input.podId,
          contentType: 'agent-session',
          label: input.label,
          config: {
            sessionId: String(session.sessionId),
            providerId: input.providerId,
          },
        })

        const viewSvc = yield* ViewController
        yield* viewSvc.ensureDefaultView(input.podId)

        return { sessionId: session.sessionId, itemId: item.id }
      }),

    /**
     * Attach an already-existing agent session to a pod as a new pod item.
     * The session row stays pod-agnostic (one session can appear in multiple
     * pods). No new runtime session is created — the item just points at the
     * existing session id, and mounting the container triggers the normal
     * `agent.session.get` rehydrate path.
     */
    attachAgentSession: effectOs
      .input(
        z.object({
          podId: z.string(),
          sessionId: z.string().min(1),
          label: z.string().min(1).default('Agent'),
        }),
      )
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) {
          throw new ORPCError('NOT_FOUND', { message: `Pod ${input.podId} not found` })
        }

        // Confirm the session exists (and is not archived). listPersisted
        // is the caller's natural filter, but a malicious / stale client
        // could still POST a random id.
        const runtime = yield* AgentRuntime
        const rows = yield* runtime.listPersisted({ workspaceId: pod.workspaceId ?? undefined }).pipe(
          Effect.tapError((e) =>
            Effect.sync(() => {
              // eslint-disable-next-line no-console
              console.error(`[pod-router] attachAgentSession(session=${input.sessionId}) listPersisted failed:`, e)
            }),
          ),
          Effect.mapError((e) => new ORPCError('INTERNAL_SERVER_ERROR', { message: e.message, cause: e })),
        )
        const found = rows.find((r) => String(r.sessionId) === input.sessionId)
        if (!found) {
          throw new ORPCError('NOT_FOUND', { message: `Session ${input.sessionId} not found for this workspace` })
        }

        const items = yield* PodItemController
        const item = yield* items.create({
          podId: input.podId,
          contentType: 'agent-session',
          label: input.label,
          config: { sessionId: input.sessionId, providerId: found.providerId },
        })

        const viewSvc = yield* ViewController
        yield* viewSvc.ensureDefaultView(input.podId)

        return { sessionId: input.sessionId, itemId: item.id }
      }),

    listAgents: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listAgents(input.podId)
    }),

    runningAgents: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.runningAgents(input.podId)
    }),

    /**
     * Force-inject agent hooks (Claude/Codex/OpenCode) into the pod's cwd.
     * Called after pod creation + template application so hooks are in place
     * before auto-start triggers. Idempotent — safe to call multiple times.
     */
    injectHooks: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const crud = yield* PodCrudController
      const podSvc = yield* PodController
      const pod = yield* crud.getById(input.podId)
      if (!pod) return
      const agents = yield* crud.listAgents(input.podId)
      const isDocker = getPodRuntime(pod)?.type === 'docker'
      const httpPort = podSvc.getHttpPort()
      const claudeHookUrl = httpPort
        ? `http://${isDocker ? 'host.docker.internal' : '127.0.0.1'}:${httpPort}/agent-status`
        : null
      for (const agent of agents) {
        try {
          if (agent.agentType === 'claude') {
            if (!claudeHookUrl) {
              log.pod.warn(`injectHooks: skipping Claude hooks for ${pod.id} — HTTP port not ready`)
            } else {
              injectClaudeHooks(pod.cwd, { httpUrl: claudeHookUrl })
            }
          } else if (agent.agentType === 'codex') injectCodexHooks(pod.cwd)
          else if (agent.agentType === 'opencode') injectOpenCodePlugin(pod.cwd)
        } catch (err) {
          log.pod.warn(`injectHooks: failed for agent ${agent.agentType} in ${pod.cwd}:`, err)
        }
      }
    }),

    // --- Command routes ---

    addCommand: effectOs.input(addCommandSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.addCommand(input)
    }),

    updateCommand: effectOs.input(updateCommandSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      const { id, ...rest } = input
      return yield* svc.updateCommand(id, rest)
    }),

    removeCommand: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.removeCommand(input.id)
    }),

    listCommands: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listCommands(input.podId)
    }),

    importCommands: effectOs.input(importCommandsSchema).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.importCommands(input.podId, input.commands)
    }),

    detectCommandFiles: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const podSvc = yield* PodController
      const pod = yield* podSvc.getById(input.podId)
      if (!pod) return []
      const parser = yield* CommandParserService
      return yield* parser.detectFiles(pod.cwd)
    }),

    detectCommandFilesDeep: effectOs
      .input(z.object({ podId: z.string(), maxDepth: z.number().optional() }))
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) return []
        const parser = yield* CommandParserService
        return yield* parser.detectFilesDeep(pod.cwd, input.maxDepth)
      }),

    parseCommandFile: effectOs
      .input(
        z.object({
          path: z.string(),
          type: z.enum(['taskfile', 'makefile', 'package-json']),
          relativePath: z.string(),
        }),
      )
      .effect(function* ({ input }) {
        const parser = yield* CommandParserService
        return yield* parser.parseFile(input)
      }),

    discoverCommands: effectOs
      .input(z.object({ podId: z.string(), maxDepth: z.number().optional() }))
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) return []
        // For templates with no cwd, fall back to the workspace's cwd
        let cwd = pod.cwd
        if (!cwd && pod.workspaceId) {
          const workspaces = yield* WorkspaceController
          const workspace = yield* workspaces.getById(pod.workspaceId)
          if (workspace) cwd = workspace.cwd
        }
        if (!cwd) return []
        const parser = yield* CommandParserService
        const files = yield* parser.detectFilesDeep(cwd, input.maxDepth)
        const all = yield* Effect.forEach(files, (f) => parser.parseFile(f), { concurrency: 'unbounded' })
        return all.flat()
      }),

    // --- Tag routes ---

    listTags: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.listTags(input.podId)
    }),

    createTag: effectOs.input(z.object({ podId: z.string(), name: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.createTag(input.podId, input.name)
    }),

    deleteTag: effectOs.input(z.object({ id: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.deleteTag(input.id)
    }),

    tagCommand: effectOs.input(z.object({ commandId: z.string(), tagId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.tagCommand(input.commandId, input.tagId)
    }),

    untagCommand: effectOs.input(z.object({ commandId: z.string(), tagId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.untagCommand(input.commandId, input.tagId)
    }),

    startCommand: effectOs.input(z.object({ podCommandId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.startCommand(input.podCommandId)
    }),

    stopCommand: effectOs.input(z.object({ podCommandId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.stopCommand(input.podCommandId)
    }),

    restartCommand: effectOs.input(z.object({ podCommandId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.restartCommand(input.podCommandId)
    }),

    runningCommands: effectOs.input(z.object({ podId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      return yield* svc.runningCommands(input.podId)
    }),

    addCommandToView: effectOs.input(z.object({ podCommandId: z.string() })).effect(function* ({ input }) {
      const svc = yield* PodController
      yield* svc.addCommandToView(input.podCommandId)
    }),

    setActiveView: effectOs.input(z.object({ podId: z.string(), viewId: z.string().nullable() })).effect(function* ({
      input,
    }) {
      const svc = yield* PodController
      return yield* svc.setActiveView(input.podId, input.viewId)
    }),

    applyTemplate: effectOs.input(z.object({ podId: z.string(), templatePodId: z.string() })).effect(function* ({
      input,
    }) {
      const svc = yield* PodCrudController
      return yield* svc.applyTemplateToPod(input.podId, input.templatePodId)
    }),

    detectEditors: orpc.handler(async () => {
      const { existsSync } = await import('node:fs')
      const { execFileSync } = await import('node:child_process')

      const editorDefs = [
        {
          id: 'zed',
          name: 'Zed',
          apps: ['/Applications/Zed.app', '/Applications/Zed Preview.app', '/Applications/Zed Nightly.app'],
          cli: 'zed',
        },
        { id: 'vscode', name: 'VS Code', apps: ['/Applications/Visual Studio Code.app'], cli: 'code' },
        { id: 'cursor', name: 'Cursor', apps: ['/Applications/Cursor.app'], cli: 'cursor' },
      ] as const

      // Resolve editors in parallel — each one does a plist read + sips call,
      // and we have at most 3 candidates, so unbounded concurrency is fine.
      const results = await Promise.all(
        editorDefs.map(async (def) => {
          const installedAppPath = def.apps.find((p) => existsSync(p))
          if (installedAppPath) {
            return {
              id: def.id,
              name: def.name,
              iconDataUrl: await extractAppIconDataUrl(installedAppPath),
            }
          }
          // CLI-only fallback: no bundle, no icon.
          try {
            execFileSync('which', [def.cli], { timeout: 2000, stdio: 'pipe' })
            return { id: def.id, name: def.name, iconDataUrl: null }
          } catch {
            return null
          }
        }),
      )

      return results.filter((r): r is NonNullable<typeof r> => r !== null)
    }),

    openInEditor: effectOs
      .input(z.object({ podId: z.string(), editor: z.enum(['zed', 'vscode', 'cursor']) }))
      .effect(function* ({ input }) {
        const podSvc = yield* PodController
        const pod = yield* podSvc.getById(input.podId)
        if (!pod) return

        const runtime = getPodRuntime(pod)
        const isDocker = runtime?.type === 'docker' && pod.containerId
        const editor = input.editor

        if (isDocker && editor === 'zed') {
          // Zed: SSH into container via wanda SSH config
          const workDir = runtime.type === 'docker' ? (runtime.workDir ?? '/workspace') : '/workspace'
          const zedCli = yield* resolveZedCli
          yield* Effect.promise(async () => {
            const { execFile } = await import('node:child_process')
            execFile(zedCli, [`ssh://${CONTAINER_PREFIX}-${pod.id}${workDir}`])
          })
        } else if (isDocker) {
          // VS Code / Cursor: Dev Containers URI
          const scheme = editor === 'vscode' ? 'vscode' : 'cursor'
          const workDir = runtime.type === 'docker' ? (runtime.workDir ?? '/workspace') : '/workspace'
          const containerName = `${CONTAINER_PREFIX}-${pod.id}`
          const uri = `${scheme}://ms-vscode-remote.remote-containers/openFolder?containerName=${encodeURIComponent(containerName)}&folderPath=${encodeURIComponent(workDir)}`
          yield* Effect.promise(async () => {
            const { shell } = await import('electron')
            shell.openExternal(uri)
          })
        } else if (editor === 'zed') {
          // PTY pod: open local folder in Zed
          const zedCli = yield* resolveZedCli
          yield* Effect.promise(async () => {
            const { execFile } = await import('node:child_process')
            execFile(zedCli, [pod.cwd])
          })
        } else {
          // PTY pod: VS Code / Cursor file URI
          const scheme = editor === 'vscode' ? 'vscode' : 'cursor'
          yield* Effect.promise(async () => {
            const { shell } = await import('electron')
            shell.openExternal(`${scheme}://file${pod.cwd}`)
          })
        }
      }),
  }
}
