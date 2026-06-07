// Maps friendly namespace names → oRPC router namespace keys
const NAMESPACE_MAP: Record<string, string> = {
  workspaces: 'workspace',
  pods: 'pod',
  podItems: 'podItem',
  views: 'view',
  workspaceSettings: 'workspaceSettings',
  workenv: 'workenv',
  workenvs: 'workenv',
  plans: 'plan',
  targets: 'target',
  agents: 'agent',
  git: 'git',
  docker: 'docker',
  notifications: 'notification',
  tasks: 'tasks',
  settings: 'settings',
  app: 'app',
}

// Convenience aliases: transform friendly args into oRPC input objects.
type Alias = { rpcMethod?: string; transform: (...args: never[]) => unknown }

const METHOD_ALIASES: Record<string, Record<string, Alias>> = {
  workspaces: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    delete: { transform: (id: string) => ({ id }) },
  },
  pods: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    list: { transform: (workspaceId: string) => ({ workspaceId }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    delete: { transform: (id: string) => ({ id }) },
    start: { transform: (id: string) => ({ id }) },
    stop: { transform: (id: string) => ({ id }) },
    restart: { transform: (id: string) => ({ id }) },
    listTerminals: { transform: (podId: string) => ({ podId }) },
    runningTerminals: { transform: (id: string) => ({ id }) },
    startTerminal: { transform: (podTerminalId: string) => ({ podTerminalId }) },
    removeTerminal: { transform: (id: string) => ({ id }) },
    updateTerminal: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
  },
  podItems: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    list: { transform: (podId: string) => ({ podId }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    delete: { transform: (id: string) => ({ id }) },
  },
  views: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    list: { rpcMethod: 'listByPod', transform: (podId: string) => ({ podId }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    delete: { transform: (id: string) => ({ id }) },
    ensureDefault: { transform: (podId: string) => ({ podId }) },
  },
  workspaceSettings: {
    get: { rpcMethod: 'getByWorkspace', transform: (workspaceId: string) => ({ workspaceId }) },
    update: { transform: (workspaceId: string, data: Record<string, unknown>) => ({ workspaceId, ...data }) },
  },
  workenvs: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    start: { transform: (id: string) => ({ id }) },
    stop: { transform: (id: string) => ({ id }) },
    destroy: { transform: (id: string) => ({ id }) },
    exec: {
      rpcMethod: 'execStart',
      transform: (id: string, cmd: string, args?: string[], cwd?: string) => ({ id, cmd, args: args ?? [], cwd }),
    },
    prebuildTemplate: { transform: (templateId: string) => ({ templateId }) },
  },
  workenv: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    start: { transform: (id: string) => ({ id }) },
    stop: { transform: (id: string) => ({ id }) },
    destroy: { transform: (id: string) => ({ id }) },
    exec: {
      rpcMethod: 'execStart',
      transform: (id: string, cmd: string, args?: string[], cwd?: string) => ({ id, cmd, args: args ?? [], cwd }),
    },
    prebuildTemplate: { transform: (templateId: string) => ({ templateId }) },
  },
  plans: {
    // All MCP-side writes default to author kind = 'agent'. The router uses
    // this to keep human review timestamps untouched and so the revisions
    // drawer can attribute the change correctly. The agent id is just 'mcp'
    // here since we don't have access to the chat session id over stdio —
    // callers can override by passing author explicitly.
    list: {
      transform: (filter?: { workspaceId?: string; kind?: string; status?: string; includeNonCanonical?: boolean }) =>
        filter ?? {},
    },
    get: { transform: (id: string) => ({ id }) },
    getBySlug: {
      transform: (workspaceId: string, slug: string) => ({ workspaceId, slug }),
    },
    create: {
      transform: (input: Record<string, unknown>) => ({
        author: { authorKind: 'agent', authorId: 'mcp' },
        ...input,
      }),
    },
    update: {
      transform: (id: string, expectedVersion: number, patch: Record<string, unknown>) => ({
        id,
        expectedVersion,
        author: { authorKind: 'agent', authorId: 'mcp' },
        ...patch,
      }),
    },
    appendNote: {
      transform: (id: string, section: string, content: string) => ({
        id,
        section,
        content,
        author: { authorKind: 'agent', authorId: 'mcp' },
      }),
    },
    setStatus: {
      transform: (id: string, status: string) => ({
        id,
        status,
        author: { authorKind: 'agent', authorId: 'mcp' },
      }),
    },
    addLink: {
      transform: (planId: string, kind: string, refId: string, label?: string) => ({
        planId,
        kind,
        refId,
        label,
      }),
    },
    removeLink: { transform: (linkId: string) => ({ linkId }) },
    listLinks: { transform: (planId: string) => ({ planId }) },
    addComment: {
      transform: (planId: string, body: string, anchor?: string) => ({
        planId,
        body,
        anchor: anchor ?? null,
        author: { authorKind: 'agent', authorId: 'mcp' },
      }),
    },
    listComments: { transform: (planId: string) => ({ planId }) },
    updateComment: {
      transform: (commentId: string, patch: Record<string, unknown>) => ({ commentId, ...patch }),
    },
    removeComment: { transform: (commentId: string) => ({ commentId }) },
    listRevisions: {
      transform: (planId: string, limit?: number) => ({ planId, limit }),
    },
    delete: { transform: (id: string) => ({ id }) },
    // Review-loop: blocking call. Returns
    //   { decision: 'approved' | 'changes_requested', feedback: [...], userNote, planId }
    // Times out after 30 minutes if the user doesn't resolve.
    submitForReview: {
      transform: (input: Record<string, unknown>) => ({
        author: { authorKind: 'agent', authorId: input.submittedByChatSessionId ?? 'mcp' },
        ...input,
      }),
    },
  },
  git: {
    discover: { transform: (podId: string) => ({ podId }) },
    getStatus: { transform: (podId: string) => ({ podId }) },
    listBranches: { transform: (podId: string) => ({ podId }) },
    listRemoteBranches: { transform: (repoUrl: string) => ({ repoUrl }) },
  },
  docker: {
    startContainer: { transform: (id: string) => ({ id }) },
    stopContainer: { transform: (id: string, timeout?: number) => ({ id, timeout }) },
    removeContainer: { transform: (id: string, force?: boolean) => ({ id, force }) },
    removeImage: { transform: (id: string, force?: boolean) => ({ id, force }) },
  },
  notifications: {
    markRead: { transform: (id: string) => ({ id }) },
    resolve: { transform: (id: string, resolution: string) => ({ id, resolution }) },
  },
  targets: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
    delete: { transform: (id: string) => ({ id }) },
  },
  agents: {
    stopSession: { transform: (id: string) => ({ id }) },
  },
  tasks: {
    get: { rpcMethod: 'getById', transform: (id: string) => ({ id }) },
    delete: { transform: (id: string) => ({ id }) },
    update: { transform: (id: string, data: Record<string, unknown>) => ({ id, ...data }) },
  },
  settings: {
    get: { transform: (key: string) => ({ key }) },
    set: { transform: (key: string, value: string | null) => ({ key, value }) },
    getMany: { transform: (keys: string[]) => ({ keys }) },
  },
}

// Documentation for help() discovery
export const NAMESPACE_DOCS: Record<string, { description: string; methods: Record<string, string> }> = {
  workspaces: {
    description: 'Manage workspaces',
    methods: {
      'list()': 'List all workspaces',
      'get(id)': 'Get workspace by ID',
      'create({ name, cwd, repoPath? })': 'Create a workspace',
      'update(id, { name?, cwd?, repoPath?, sortOrder? })': 'Update a workspace',
      'delete(id)': 'Delete a workspace',
    },
  },
  pods: {
    description: 'Manage pods (terminal groups), their terminals, and lifecycle',
    methods: {
      'list(workspaceId)': 'List pods in a workspace',
      'get(id)': 'Get pod by ID',
      'create({ workspaceId, name, cwd, shell?, env?, runtime? })': 'Create a pod',
      'update(id, { name?, cwd?, shell?, env?, sortOrder?, runtime? })': 'Update a pod',
      'delete(id)': 'Delete a pod',
      'start(id)': 'Start a pod',
      'stop(id)': 'Stop a pod',
      'restart(id)': 'Restart a pod',
      'addTerminal({ podId, name, command?, args?, env?, restartPolicy? })': 'Add a terminal to a pod',
      'updateTerminal(id, { name?, command?, args?, env?, restartPolicy?, sortOrder? })': 'Update a terminal',
      'removeTerminal(id)': 'Remove a terminal from a pod',
      'listTerminals(podId)': 'List terminals in a pod',
      'runningTerminals(id)': 'List running terminals in a pod',
      'startTerminal(podTerminalId)': 'Start a specific terminal',
      'setActiveView({ podId, viewId })': 'Set the active view for a pod',
    },
  },
  podItems: {
    description: 'Manage items (terminals/processes) within pods',
    methods: {
      'list(podId)': 'List items in a pod',
      'get(id)': 'Get item by ID',
      'update(id, { label?, labelSource?, sortOrder? })': 'Update an item',
      'delete(id)': 'Delete an item',
    },
  },
  views: {
    description: 'Manage views (layout configurations) for pods',
    methods: {
      'list(podId)': 'List views for a pod',
      'get(id)': 'Get view by ID',
      'create({ podId, name, viewType?, config?, itemSettings?, sortOrder? })': 'Create a view',
      'update(id, { name?, config?, itemSettings?, sortOrder? })': 'Update a view',
      'delete(id)': 'Delete a view',
      'applyTemplate({ templateId, podId })': 'Apply a view template to a pod',
      'ensureDefault(podId)': 'Ensure a pod has a default view',
    },
  },
  workspaceSettings: {
    description: 'Manage workspace default settings for new pods',
    methods: {
      'get(workspaceId)': 'Get settings for a workspace',
      'update(workspaceId, { defaultTemplatePodId?, defaultWorkenvTemplateId?, autoGeneratePodName?, defaultRuntime?, gitWorktreeEnabled?, gitWorktreeCopyHiddenFiles? })':
        'Update workspace settings',
    },
  },
  workenvs: {
    description: 'Manage reusable VM environments and per-pod workenv VMs',
    methods: {
      'list()': 'List workenv VMs',
      'get(id)': 'Get a workenv by ID',
      'create({ name, slug, config, templateId? })': 'Create a workenv VM',
      'update(id, { name?, config? })': 'Update a workenv',
      'start(id)': 'Start a workenv VM',
      'stop(id)': 'Stop a workenv VM',
      'destroy(id)': 'Destroy a workenv VM',
      'exec(id, cmd, args?, cwd?)': 'Run a command inside a running workenv',
      'listTemplates()': 'List reusable environment definitions',
      'importTemplateYaml({ yaml })': 'Import an environment definition from YAML',
      'exportTemplateYaml({ id })': 'Export an environment definition to YAML',
      'prebuildTemplate(templateId)': 'Build or refresh a template prebuild',
    },
  },
  workenv: {
    description: 'Alias for workenvs',
    methods: {
      'list()': 'List workenv VMs',
      'get(id)': 'Get a workenv by ID',
      'create({ name, slug, config, templateId? })': 'Create a workenv VM',
      'update(id, { name?, config? })': 'Update a workenv',
      'start(id)': 'Start a workenv VM',
      'stop(id)': 'Stop a workenv VM',
      'destroy(id)': 'Destroy a workenv VM',
      'exec(id, cmd, args?, cwd?)': 'Run a command inside a running workenv',
      'listTemplates()': 'List reusable environment definitions',
      'importTemplateYaml({ yaml })': 'Import an environment definition from YAML',
      'exportTemplateYaml({ id })': 'Export an environment definition to YAML',
      'prebuildTemplate(templateId)': 'Build or refresh a template prebuild',
    },
  },
  plans: {
    description:
      'Durable workspace plans (PRDs, task plans, proposals). Read first via plans.get(id) so the staleness verdict is in scope. Default writes are attributed to "agent" — humans editing in the UI keep that attribution distinct.',
    methods: {
      'list({ workspaceId?, kind?, status?, includeNonCanonical? })':
        'List plans across one or all workspaces. Default excludes drafts/superseded/archived.',
      'get(id)':
        'Get a plan by id. Returns body + version + staleness + links. Always check `staleness.isStale` and surface the warning before acting on the body.',
      'getBySlug(workspaceId, slug)': 'Look up a plan by slug within a workspace.',
      'create({ workspaceId, title, kind?, body?, status?, slug?, staleAfterDays?, links?, submittedByChatSessionId?, author? })':
        'Create a plan. Defaults: kind=prd, status=active for prds and draft otherwise. Returns the created plan.',
      'update(id, expectedVersion, { body?, title?, staleAfterDays?, summary?, author? })':
        'Whole-document replace with optimistic locking. Throws on stale expectedVersion — re-read with get() and try again. Prefer appendNote() for additive changes.',
      'appendNote(id, section, content)':
        'Append markdown under "## <section>" — server-side merge, never conflicts with concurrent edits. Section is created at the bottom if not present. Use this for decisions, learnings, and progress notes.',
      'setStatus(id, status)':
        'Transition status: draft|active|completed|archived|superseded. Active plans are returned in default search; completed/archived/superseded are excluded.',
      'addLink(planId, kind, refId, label?)':
        'Soft-link a plan to a workenv|pod|chatSession|branch. Idempotent on (kind, refId). Plans persist when the linked entity is deleted.',
      'removeLink(linkId)': 'Remove a soft link.',
      'listLinks(planId)': 'List all soft links on a plan.',
      'addComment(planId, body, anchor?)':
        'Post a comment, optionally anchored to a heading text. For review-loop plans (those with submittedByChatSessionId), comments default to includeInFeedback=true.',
      'listComments(planId)': 'List comments on a plan.',
      'updateComment(commentId, { body?, includeInFeedback?, resolved? })':
        'Edit a comment, toggle its inclusion in the feedback bundle, or resolve / reopen.',
      'removeComment(commentId)': 'Delete a comment.',
      'listRevisions(planId, limit?)': 'List recent revisions newest-first (default 50, max 200).',
      'delete(id)': 'Permanently delete a plan and all its revisions, comments, and links.',
      'submitForReview({ workspaceId, title, body?, kind?, submittedByChatSessionId, links?, author? })':
        'Create a draft plan and BLOCK until a human approves or requests changes. Returns { decision, feedback, userNote, planId } where feedback is the bundle of UI comments the user marked "Send to agent". Times out after 30 minutes — re-call to resubmit.',
    },
  },
  git: {
    description: 'Git operations scoped to pods',
    methods: {
      'discover(podId)': 'Discover git repo in pod working directory',
      'getStatus(podId)': 'Get git status for pod',
      'getDiff({ podId, mode, baseRef? })': 'Get git diff (mode: uncommitted|branch)',
      'listBranches(podId)': 'List local branches in pod repo',
      'setContext({ podId, gitContext })': 'Set git context for a pod',
      'listRemoteBranches(repoUrl)': 'List remote branches for a repo URL',
    },
  },
  docker: {
    description: 'Docker container and image management',
    methods: {
      'listContainers({ all? })': 'List Docker containers',
      'listImages()': 'List Docker images',
      'startContainer(id)': 'Start a container',
      'stopContainer(id, timeout?)': 'Stop a container',
      'removeContainer(id, force?)': 'Remove a container',
      'removeImage(id, force?)': 'Remove an image',
      'checkAvailable()': 'Check if Docker is available',
      'containerStats({ containerIds })': 'Get stats for containers',
      'cleanupStopped()': 'Remove orphan Wanda containers',
    },
  },
  notifications: {
    description: 'Manage in-app notifications',
    methods: {
      'unresolvedCounts()': 'Get counts of unresolved notifications by priority',
      'listUnresolved()': 'List all unresolved notifications',
      'listRecent({ limit? })': 'List recent notifications',
      'markRead(id)': 'Mark a notification as read',
      'resolve(id, resolution)': 'Resolve a notification',
    },
  },
  targets: {
    description: 'Manage execution targets (local and remote machines)',
    methods: {
      'list()': 'List all targets',
      'get(id)': 'Get target by ID',
      'create({ name, host, port?, authToken })': 'Create a remote target',
      'update(id, { name?, host?, port?, authToken? })': 'Update a target',
      'delete(id)': 'Delete a target',
      'testConnection({ host, port?, authToken })': 'Test connection to a remote target',
    },
  },
  agents: {
    description: 'Manage AI agent sessions',
    methods: {
      'startSession({ cwd })': 'Start a new agent session',
      'sendMessage({ id, message, model? })': 'Send a message to an agent session',
      'stopSession(id)': 'Stop an agent session',
      'list()': 'List active agent sessions',
    },
  },
  tasks: {
    description: 'Local task, project, and workspace management',
    methods: {
      'list({ projectId?, status?, type?, assignable? })': 'List tasks with optional filters',
      'get(id)': 'Get task by ID',
      'create({ title, projectId, parentId?, description?, type?, status?, priority?, labels?, dependsOn? })':
        'Create a task',
      'update(id, { title?, description?, type?, priority?, labels?, dependsOn? })': 'Update a task',
      'delete(id)': 'Delete a task',
      'publish({ id })': 'Publish a draft task to ready',
      'claim({ id, agentId, leaseTtl? })': 'Claim a task for an agent',
      'complete({ id, output?, data? })': 'Mark a task as complete',
      'fail({ id, reason })': 'Mark a task as failed',
      'block({ id, reason })': 'Mark a task as blocked',
      'unblock({ id })': 'Unblock a task',
      'release({ id })': 'Release a claimed task',
      'renew({ id, ttl? })': 'Renew a task lease',
      'nextReady({ projectId?, assignable? })': 'Get next ready task',
      'getTree({ id })': 'Get a task tree',
      'listProjects({ workspaceId?, archived? })': 'List projects',
      'getProject({ id })': 'Get project by ID',
      'createProject({ name, workspaceId, description?, config? })': 'Create a project',
      'updateProject({ id, expectedVersion, name?, description?, config? })': 'Update a project',
      'archiveProject({ id })': 'Archive a project',
      'listWorkspaces()': 'List workspaces',
      'getWorkspace({ id })': 'Get workspace by ID',
      'createWorkspace({ name, description?, config? })': 'Create a workspace',
      'updateWorkspace({ id, expectedVersion, name?, description?, config? })': 'Update a workspace',
      'archiveWorkspace({ id })': 'Archive a workspace',
    },
  },
  settings: {
    description: 'App settings (key/value store)',
    methods: {
      'get(key)': 'Get a setting value',
      'getMany(keys)': 'Get multiple settings at once',
      'set(key, value)': 'Set a setting (value can be null to delete)',
    },
  },
  app: {
    description: 'System utilities',
    methods: {
      'getHomeDir()': 'Get the home directory path',
      'selectDirectory()': 'Open a native directory picker dialog',
    },
  },
}

export type WandaRuntime = Record<string, unknown>

/**
 * Build an MCP-facing runtime proxy around the oRPC client. The typing is
 * intentionally loose — the runtime is a dynamic dispatcher into a router
 * whose method signatures aren't known statically. Each dispatched call's
 * input is Zod-validated at the oRPC boundary, so runtime safety holds
 * even though the TypeScript surface is `Record<string, unknown>`.
 */
export function createRuntime(orpc: object): WandaRuntime {
  return new Proxy(
    {},
    {
      get(_, nsName: string) {
        // Prevent Promise unwrapping when returned from async functions
        if (nsName === 'then' || nsName === 'toJSON') return undefined

        if (nsName === 'help') {
          return () => {
            const result: Record<string, string> = {}
            for (const [ns, docs] of Object.entries(NAMESPACE_DOCS)) {
              const methodNames = Object.keys(docs.methods).map((sig) => sig.replace(/\(.*/, ''))
              result[ns] = `${docs.description} (${methodNames.join(', ')})`
            }
            result._usage = 'Call wanda.<namespace>.help() for method details'
            return result
          }
        }

        const routerNsKey = NAMESPACE_MAP[nsName]
        if (!routerNsKey) return undefined

        // Support dotted keys (e.g. 'view.listByPod' → orpc.view.listByPod)
        let routerNs: unknown = orpc
        for (const part of routerNsKey.split('.')) {
          routerNs = (routerNs as Record<string, unknown> | null | undefined)?.[part]
        }
        if (!routerNs) return undefined

        const nsAliases = METHOD_ALIASES[nsName] ?? {}
        const nsDocs = NAMESPACE_DOCS[nsName]

        return new Proxy(
          {},
          {
            get(_, method: string) {
              if (method === 'then' || method === 'toJSON') return undefined

              if (method === 'help') {
                return () =>
                  nsDocs
                    ? { namespace: nsName, description: nsDocs.description, methods: nsDocs.methods }
                    : { namespace: nsName, description: 'No documentation available' }
              }

              return (...args: unknown[]) => {
                const alias = nsAliases[method]
                const rpcMethodName = alias?.rpcMethod ?? method
                const routerNsRecord = routerNs as Record<string, unknown>
                const rpcFn = routerNsRecord[rpcMethodName] as ((input: unknown) => unknown) | undefined

                if (typeof rpcFn !== 'function') {
                  throw new Error(
                    `Unknown method: wanda.${nsName}.${method}. Call wanda.${nsName}.help() for available methods.`,
                  )
                }

                if (alias) {
                  // If single object arg (not array), pass through directly to rpc method
                  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
                    return rpcFn(args[0])
                  }
                  // Use alias transform for convenience signatures
                  return rpcFn(alias.transform(...(args as never[])))
                }

                // No alias — pass first arg through (or empty object)
                return rpcFn(args[0] ?? {})
              }
            },
          },
        )
      },
    },
  )
}
