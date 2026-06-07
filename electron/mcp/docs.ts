export interface DocEntry {
  title: string
  keywords: string[]
  content: string
}

export const DOCS: DocEntry[] = [
  // --- Concepts ---
  {
    title: 'Hierarchy: Workspaces and Pods',
    keywords: ['workspace', 'pod', 'hierarchy', 'structure', 'organization'],
    content: `Workspace → Pod → Terminal.

A **workspace** typically maps to a repo or service.
A **pod** is a runnable terminal group inside a workspace. Each pod has one or more **terminals** (shell sessions).

Pods can run locally (PTY) or inside Docker containers. When using Docker, a pod gets its own container with isolated networking, filesystem, and resource limits.

Key methods: workspaces.list(), pods.list(workspaceId), pods.listTerminals(podId).`,
  },
  {
    title: 'Targets: Local and Remote Execution',
    keywords: ['target', 'remote', 'local', 'daemon', 'websocket', 'machine', 'server'],
    content: `A **target** is a machine where pods execute. The built-in "local" target runs on this machine. Remote targets connect to an Wanda daemon via WebSocket.

Remote targets use dual WebSocket channels: a control channel (oRPC commands) and a data channel (PTY streaming, port forwarding).

targets.create({ name, host, port, authToken }) adds a remote target.
targets.testConnection({ host, port, authToken }) verifies connectivity before saving.

Assign a target to a pod via pods.update(id, { targetId }) or pods.create({ ..., targetId }).`,
  },
  // --- Recipes ---
  {
    title: 'Recipe: Manage Remote Targets',
    keywords: ['recipe', 'remote', 'target', 'connect', 'daemon', 'test'],
    content: `Steps to set up a remote target:

1. Test the connection first:
   await wanda.targets.testConnection({ host: "192.168.1.100", port: 9876, authToken: "my-token" })

2. Create the target:
   const target = await wanda.targets.create({
     name: "Dev server", host: "192.168.1.100", port: 9876, authToken: "my-token"
   })

3. Assign a pod to run on the remote target:
   await wanda.pods.update(podId, { targetId: target.id })

4. Start the pod — it runs on the remote machine:
   await wanda.pods.start(podId)`,
  },
  {
    title: 'Recipe: Check Pod and Container Status',
    keywords: ['recipe', 'status', 'container', 'inspect', 'health', 'running', 'stopped'],
    content: `Useful commands for checking pod health:

1. Get pod status:
   const pod = await wanda.pods.get(podId)
   // pod.status: stopped | starting | running | stopping | failed

2. List running terminals:
   const terms = await wanda.pods.runningTerminals(podId)

3. List all Docker containers:
   const containers = await wanda.docker.listContainers({ all: true })

4. Get container resource stats:
   await wanda.docker.containerStats({ containerIds: [pod.containerId] })

5. Check Docker availability:
   await wanda.docker.checkAvailable()

6. Clean up orphaned containers:
   await wanda.docker.cleanupStopped()`,
  },
  {
    title: 'Recipe: Work with Git in Pods',
    keywords: ['recipe', 'git', 'branch', 'diff', 'status', 'repo'],
    content: `Git operations are scoped to pods:

1. Discover the git repo in the pod's working directory:
   const repo = await wanda.git.discover(podId)

2. Check git status:
   const status = await wanda.git.getStatus(podId)

3. Get the diff of uncommitted changes:
   const diff = await wanda.git.getDiff({ podId, mode: "uncommitted" })

4. Get a branch diff:
   const branchDiff = await wanda.git.getDiff({ podId, mode: "branch", baseRef: "main" })

5. List local branches:
   const branches = await wanda.git.listBranches(podId)

6. List remote branches for a repo URL:
   const remote = await wanda.git.listRemoteBranches("https://github.com/org/repo.git")`,
  },
]
