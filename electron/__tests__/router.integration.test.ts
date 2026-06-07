import { join } from 'node:path'
import { createRouterClient, type RouterClient } from '@orpc/server'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { v4 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runMigrations } from '../db/migrate'
import * as schema from '../db/schema'
import * as taskSchema from '../db/task-schema'
import { GitControllerLive } from '../domains/git/controller'
import { NotificationControllerLive } from '../domains/notification/controller'
import { PlanControllerLive } from '../domains/plan/controller'
import {
  PodContainerControllerLive,
  PodControllerLive,
  PodCrudControllerLive,
  PodItemControllerLive,
  PodLifecycleControllerLive,
} from '../domains/pod/controller'
import { AgentConfigControllerLive, SettingsControllerLive } from '../domains/settings/controller'
import { ViewControllerLive } from '../domains/view/controller'
import {
  BootstrapRunnerLive,
  WorkenvControllerLive,
  WorkenvEventsLive,
  WorkenvExecLive,
  WorkenvHealthLive,
  WorkenvTemplatesLive,
} from '../domains/workenv'
import { WorkspaceControllerLive, WorkspaceSettingsControllerLive } from '../domains/workspace/controller'
import { Broadcaster } from '../infra/broadcaster'
import { DatabaseService } from '../infra/database'
import { AgentStatusServiceLive } from '../packages/agent-hooks'
import { PtyService, type PtyServiceShape } from '../services/pty.service'
import { makeRuntimeRegistryLive } from '../services/runtime-registry.service'
import { FakeRuntimeAdapter } from '../testing/fake-runtime-adapter'

function makeTestLayer() {
  const testDb = Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../db/migrations'))
    return db
  })

  const testPty = Layer.sync(
    PtyService,
    (): PtyServiceShape => ({
      create: (config) =>
        Effect.sync(() => {
          const id = uuid()
          if (config.onExit) {
            // Store callback for potential use
          }
          return id
        }),
      destroy: (_id) => Effect.sync(() => {}),
      restart: (_id) => Effect.sync(() => {}),
      list: () => Effect.sync(() => []),
      write: () => {},
      resize: () => {},
      destroyAll: () => {},
      onAnyData: () => () => {},
      onAnyExit: () => () => {},
      getScrollback: () => '',
      getScrollbackAsync: () => Promise.resolve(''),
      clear: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
      ack: () => {},
      configure: () => {},
      engine: null as never,
      ready: Promise.resolve(),
    }),
  )

  const testBroadcaster = Layer.sync(Broadcaster, () => ({
    send: () => {},
  }))

  const base = Layer.mergeAll(testDb, testPty, testBroadcaster, AgentStatusServiceLive)
  const core = Layer.mergeAll(
    WorkspaceControllerLive,
    SettingsControllerLive,
    AgentConfigControllerLive,
    PodItemControllerLive,
    ViewControllerLive,
    WorkspaceSettingsControllerLive,
    GitControllerLive,
    NotificationControllerLive,
    PlanControllerLive,
  ).pipe(Layer.provideMerge(base))

  // Workenv stack — built BELOW the pod controller so PodControllerLive
  // can pull WorkenvController for auto-starting attached VMs.
  const registryLayer = makeRuntimeRegistryLive({
    adapters: [new FakeRuntimeAdapter({ runtime: 'orbstack' })],
  })
  const workenvFoundation = Layer.mergeAll(WorkenvEventsLive, registryLayer).pipe(Layer.provideMerge(core))
  const workenvFoundationWithExec = WorkenvExecLive.pipe(Layer.provideMerge(workenvFoundation))
  const withBootstrap = BootstrapRunnerLive.pipe(Layer.provideMerge(workenvFoundationWithExec))
  const withHealth = WorkenvHealthLive.pipe(Layer.provideMerge(withBootstrap))
  const withTemplates = WorkenvTemplatesLive.pipe(Layer.provideMerge(withHealth))
  const withWorkenv = WorkenvControllerLive.pipe(Layer.provideMerge(withTemplates))

  const withPodSupport = Layer.mergeAll(
    PodCrudControllerLive,
    PodLifecycleControllerLive,
    PodContainerControllerLive,
  ).pipe(Layer.provideMerge(withWorkenv))
  return PodControllerLive.pipe(Layer.provideMerge(withPodSupport))
}

describe('oRPC Router Integration', () => {
  let client: RouterClient<ReturnType<typeof import('../router').createAppRouter>>
  let runtime: ManagedRuntime.ManagedRuntime<any, never>

  beforeEach(async () => {
    const layer = makeTestLayer()
    runtime = ManagedRuntime.make(layer)
    // Dynamically import to avoid top-level electron import
    const { createAppRouter } = await import('../router')
    const router = createAppRouter(runtime as any)
    client = createRouterClient(router)
  })

  afterEach(async () => {
    await runtime.dispose()
  })

  // --- Workspace ---

  describe('workspace', () => {
    it('create generates ID', async () => {
      const proj = await client.workspace.create({ name: 'My Project', cwd: '/tmp' })
      expect(proj.id).toBeTruthy()
    })

    it('list returns all projects', async () => {
      await client.workspace.create({ name: 'P1', cwd: '/tmp' })
      await client.workspace.create({ name: 'P2', cwd: '/tmp' })

      const list = await client.workspace.list()
      expect(list).toHaveLength(2)
    })

    it('delete cascades to pods', async () => {
      const proj = await client.workspace.create({ name: 'P1', cwd: '/tmp' })
      await client.pod.create({ workspaceId: proj.id, name: 'Pod1', cwd: '/tmp' })

      await client.workspace.delete({ id: proj.id })

      const pods = await client.pod.list({ workspaceId: proj.id })
      expect(pods).toHaveLength(0)
    })
  })

  // --- Pod ---

  describe('pod', () => {
    let workspaceId: string

    beforeEach(async () => {
      const proj = await client.workspace.create({ name: 'Test Project', cwd: '/tmp' })
      workspaceId = proj.id
    })

    it('create + getById roundtrip', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'My Pod', cwd: '/home' })
      expect(pod.id).toBeTruthy()
      expect(pod.status).toBe('stopped')

      const found = await client.pod.getById({ id: pod.id })
      expect(found).toBeDefined()
      expect(found!.name).toBe('My Pod')
    })

    it('addTerminal + listTerminals', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      const term = await client.pod.addTerminal({ podId: pod.id, name: 'shell' })
      expect(term.id).toBeTruthy()

      const terms = await client.pod.listTerminals({ podId: pod.id })
      expect(terms).toHaveLength(1)
      expect(terms[0]!.name).toBe('shell')
    })

    it('runningTerminals is empty before start', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      const running = await client.pod.runningTerminals({ id: pod.id })
      expect(running).toHaveLength(0)
    })

    it('start changes status to running and populates runningTerminals', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      await client.pod.start({ id: pod.id })

      const updated = await client.pod.getById({ id: pod.id })
      expect(updated!.status).toBe('running')

      const running = await client.pod.runningTerminals({ id: pod.id })
      expect(running).toHaveLength(1)
      expect(running[0]!.ptyInstanceId).toBeTruthy()
    })

    it('stop changes status to stopped and clears runningTerminals', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      await client.pod.start({ id: pod.id })
      await client.pod.stop({ id: pod.id })

      const updated = await client.pod.getById({ id: pod.id })
      expect(updated!.status).toBe('stopped')

      const running = await client.pod.runningTerminals({ id: pod.id })
      expect(running).toHaveLength(0)
    })

    it('restart does stop + start cycle', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      await client.pod.start({ id: pod.id })
      await client.pod.restart({ id: pod.id })

      const updated = await client.pod.getById({ id: pod.id })
      expect(updated!.status).toBe('running')
    })

    it('delete while running stops first then deletes', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })
      await client.pod.start({ id: pod.id })

      await client.pod.delete({ id: pod.id })

      const found = await client.pod.getById({ id: pod.id })
      expect(found).toBeUndefined()
    })

    it('createFromPod + applyTemplate preserve items and remap canvas positions', async () => {
      const source = await client.pod.create({ workspaceId, name: 'Source', cwd: '/tmp' })
      await client.pod.addAgent({ podId: source.id, name: 'Claude', agentType: 'claude' })
      const cmd = await client.pod.addCommand({
        podId: source.id,
        name: 'Dev server',
        command: 'bun dev',
        directory: 'app',
        directoryMode: 'relative',
      })
      await client.pod.addCommandToView({ podCommandId: cmd.id })
      await client.podItem.create({
        podId: source.id,
        contentType: 'browser',
        label: 'Preview',
        config: { url: 'http://localhost:3000' },
        sortOrder: 7,
      })

      const sourceItems = await client.podItem.list({ podId: source.id })
      const agentItem = sourceItems.find((i) => i.contentType === 'agent')!
      await client.podItem.update({ id: agentItem.id, label: 'Custom agent label', labelSource: 'user', sortOrder: 5 })
      const commandItem = sourceItems.find((i) => i.contentType === 'command')!
      const browserItem = sourceItems.find((i) => i.contentType === 'browser')!

      await client.view.create({
        podId: source.id,
        name: 'Canvas',
        viewType: 'canvas',
        config: {
          type: 'canvas',
          nodes: [
            { itemId: agentItem.id, x: 10, y: 20, width: 500, height: 400 },
            { itemId: commandItem.id, x: 530, y: 20, width: 300, height: 200 },
            { itemId: browserItem.id, x: 10, y: 450, width: 640, height: 360 },
          ],
          focusedItemId: agentItem.id,
        },
      })

      const template = await client.template.createFromPod({
        podId: source.id,
        name: 'Template',
        workspaceId,
      })
      expect(template).toBeTruthy()

      const target = await client.pod.create({ workspaceId, name: 'Target', cwd: '/tmp' })
      await client.pod.applyTemplate({ podId: target.id, templatePodId: template!.id })

      const targetItems = await client.podItem.list({ podId: target.id })
      const targetItemIds = new Set(targetItems.map((i) => i.id))
      const targetAgent = targetItems.find((i) => i.contentType === 'agent')
      expect(targetAgent?.label).toBe('Custom agent label')
      expect(targetAgent?.labelSource).toBe('user')
      expect(targetAgent?.sortOrder).toBe(5)
      expect(targetItems.some((i) => i.contentType === 'command')).toBe(true)
      expect(targetItems.some((i) => i.contentType === 'browser')).toBe(true)

      const targetCanvas = (await client.view.listByPod({ podId: target.id })).find((v) => v.name === 'Canvas')!
      expect(targetCanvas).toBeTruthy()
      const canvasConfig = targetCanvas.config as {
        type: 'canvas'
        nodes: Array<{ itemId: string; x: number; y: number; width: number; height: number }>
        focusedItemId?: string
      }
      expect(canvasConfig.nodes).toHaveLength(3)
      expect(canvasConfig.nodes.every((node) => targetItemIds.has(node.itemId))).toBe(true)
      expect(canvasConfig.nodes.find((node) => node.itemId === targetAgent?.id)).toMatchObject({
        x: 10,
        y: 20,
        width: 500,
        height: 400,
      })
      expect(canvasConfig.focusedItemId).toBe(targetAgent?.id)
    })

    it('startCommand returns null for a missing relative directory instead of throwing', async () => {
      const pod = await client.pod.create({ workspaceId, name: 'P', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })
      const cmd = await client.pod.addCommand({
        podId: pod.id,
        name: 'Missing dir',
        command: 'echo hi',
        directory: 'does-not-exist',
        directoryMode: 'relative',
      })
      await client.pod.start({ id: pod.id })

      await expect(client.pod.startCommand({ podCommandId: cmd.id })).resolves.toBeNull()
    })
  })

  // --- Settings ---

  describe('settings', () => {
    it('set and get roundtrip', async () => {
      await client.settings.set({ key: 'test.key', value: 'hello' })
      const val = await client.settings.get({ key: 'test.key' })
      expect(val).toBe('hello')
    })

    it('get returns null for missing key', async () => {
      const val = await client.settings.get({ key: 'nonexistent' })
      expect(val).toBeNull()
    })

    it('getMany returns multiple values', async () => {
      await client.settings.set({ key: 'a', value: '1' })
      await client.settings.set({ key: 'b', value: '2' })
      const vals = await client.settings.getMany({ keys: ['a', 'b', 'c'] })
      expect(vals).toEqual({ a: '1', b: '2', c: null })
    })

    it('set null deletes the key', async () => {
      await client.settings.set({ key: 'temp', value: 'val' })
      await client.settings.set({ key: 'temp', value: null })
      const val = await client.settings.get({ key: 'temp' })
      expect(val).toBeNull()
    })
  })

  // --- App ---

  describe('app', () => {
    it('getHomeDir returns a path', async () => {
      const home = await client.app.getHomeDir()
      expect(typeof home).toBe('string')
      expect(home.length).toBeGreaterThan(0)
    })
  })

  // --- Workenv ---

  describe('workenv', () => {
    it('create + getById roundtrip', async () => {
      const w = await client.workenv.create({
        name: 'demo',
        slug: 'demo',
        config: { runtime: 'orbstack', worktreePath: '/tmp/demo' },
      })
      expect(w.id).toBeTruthy()
      expect(w.state).toBe('stopped')
      expect(w.adapterHandle).not.toBeNull()

      const found = await client.workenv.getById({ id: w.id })
      expect(found?.name).toBe('demo')
    })

    it('list returns all workenvs', async () => {
      await client.workenv.create({
        name: 'a',
        slug: 'a',
        config: { runtime: 'orbstack', worktreePath: '/a' },
      })
      await client.workenv.create({
        name: 'b',
        slug: 'b',
        config: { runtime: 'orbstack', worktreePath: '/b' },
      })
      const all = await client.workenv.list()
      expect(all.map((w) => w.slug).sort()).toEqual(['a', 'b'])
    })

    it('start + stop drives state transitions', async () => {
      const w = await client.workenv.create({
        name: 'demo',
        slug: 'demo',
        config: { runtime: 'orbstack', worktreePath: '/tmp/demo' },
      })
      await client.workenv.start({ id: w.id })
      let after = await client.workenv.getById({ id: w.id })
      expect(after?.state).toBe('running')

      await client.workenv.stop({ id: w.id })
      after = await client.workenv.getById({ id: w.id })
      expect(after?.state).toBe('stopped')
    })

    it('destroy hard-deletes the row', async () => {
      const w = await client.workenv.create({
        name: 'demo',
        slug: 'demo',
        config: { runtime: 'orbstack', worktreePath: '/tmp/demo' },
      })
      await client.workenv.destroy({ id: w.id })
      expect(await client.workenv.getById({ id: w.id })).toBeUndefined()
      expect(await client.workenv.list()).toEqual([])
    })

    it('listEvents surfaces persisted lifecycle events', async () => {
      const w = await client.workenv.create({
        name: 'demo',
        slug: 'demo',
        config: { runtime: 'orbstack', worktreePath: '/tmp/demo' },
      })
      const events = await client.workenv.listEvents({ id: w.id })
      const types = events.map((e) => e.type).sort()
      expect(types).toContain('created')
      expect(types).toContain('state.changed')
    })

    it('create with extends merges template ports and bootstrap into the workenv', async () => {
      const tpl = await client.workenv.createTemplate({
        name: 'Test base',
        runtime: 'orbstack',
        config: {
          runtime: 'orbstack',
          ports: [{ name: 'web', guest: 3000, host: 'auto', protocol: 'tcp' }],
          bootstrap: [{ kind: 'shell', run: 'echo template' }],
        },
      })

      const w = await client.workenv.create({
        name: 'derived',
        slug: 'derived',
        templateId: tpl.id,
        config: {
          runtime: 'orbstack',
          worktreePath: '/tmp/derived',
          extends: [tpl.id],
          ports: [{ name: 'pg', guest: 5432, host: 5433, protocol: 'tcp' }],
        },
      })

      expect(w.config.ports?.map((p) => p.name)).toEqual(['web', 'pg'])
      expect(w.config.bootstrap?.[0]).toEqual({ kind: 'shell', run: 'echo template' })
      expect(w.templateId).toBe(tpl.id)
    })

    it('exports and imports workenv templates as YAML through the router', async () => {
      const tpl = await client.workenv.createTemplate({
        name: 'YAML stack',
        description: 'Shareable config',
        runtime: 'orbstack',
        config: {
          env: { TOOL_HOME: '/opt/tool' },
          layers: [
            {
              kind: 'tool',
              id: 'tool:task',
              name: 'Task',
              install: [{ run: 'echo task' }],
            },
          ],
        },
      })

      const yaml = await client.workenv.exportTemplateYaml({ id: tpl.id })
      expect(yaml).toContain('kind: wanda.workenv.template')
      expect(yaml).toContain('name: YAML stack')

      await client.workenv.deleteTemplate({ id: tpl.id })
      const imported = await client.workenv.importTemplateYaml({ yaml })
      expect(imported.id).toBe(tpl.id)
      expect(imported.name).toBe('YAML stack')
      expect(imported.config.env).toEqual({ TOOL_HOME: '/opt/tool' })
    })

    it('create with unknown template ref fails cleanly', async () => {
      const result = await client.workenv
        .create({
          name: 'ghost',
          slug: 'ghost',
          config: {
            runtime: 'orbstack',
            worktreePath: '/tmp/ghost',
            extends: ['no-such-template'],
          },
        })
        .catch((err) => err as Error)
      expect(result).toBeInstanceOf(Error)
      // No row was inserted, so the listener sees an empty table.
      const all = await client.workenv.list()
      expect(all.find((w) => w.slug === 'ghost')).toBeUndefined()
    })
  })

  // --- Pod ↔ Workenv attach ---

  describe('pod.setWorkenv / unsetWorkenv', () => {
    it('attach + detach a workenv to a pod', async () => {
      const proj = await client.workspace.create({ name: 'P', cwd: '/tmp' })
      const pod = await client.pod.create({ workspaceId: proj.id, name: 'pod', cwd: '/tmp' })
      const w = await client.workenv.create({
        name: 'env',
        slug: 'env',
        config: { runtime: 'orbstack', worktreePath: '/tmp/env' },
      })

      const attached = await client.pod.setWorkenv({ id: pod.id, workenvId: w.id })
      expect(attached?.workenvId).toBe(w.id)

      const detached = await client.pod.unsetWorkenv({ id: pod.id })
      expect(detached?.workenvId).toBeNull()
    })

    it('destroying a workenv detaches attached pods (set null)', async () => {
      const proj = await client.workspace.create({ name: 'P', cwd: '/tmp' })
      const pod = await client.pod.create({ workspaceId: proj.id, name: 'pod', cwd: '/tmp' })
      const w = await client.workenv.create({
        name: 'env',
        slug: 'env',
        config: { runtime: 'orbstack', worktreePath: '/tmp/env' },
      })
      await client.pod.setWorkenv({ id: pod.id, workenvId: w.id })

      await client.workenv.destroy({ id: w.id })

      const after = await client.pod.getById({ id: pod.id })
      expect(after?.workenvId).toBeNull()
    })

    it('starting a workenv-attached pod routes its terminals through workenv exec', async () => {
      const proj = await client.workspace.create({ name: 'P', cwd: '/tmp' })
      const pod = await client.pod.create({ workspaceId: proj.id, name: 'pod', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      const w = await client.workenv.create({
        name: 'env',
        slug: 'env',
        config: { runtime: 'orbstack', worktreePath: '/tmp/env' },
      })
      await client.workenv.start({ id: w.id })
      await client.pod.setWorkenv({ id: pod.id, workenvId: w.id })

      await client.pod.start({ id: pod.id })

      // Workenv-attached pod terminals don't route through the local PTY
      // tracker; they go through WorkenvExec → adapter.exec(). The pod's
      // status flips to running and a stream id is captured.
      const updated = await client.pod.getById({ id: pod.id })
      expect(updated!.status).toBe('running')
      const running = await client.pod.runningTerminals({ id: pod.id })
      expect(running).toHaveLength(1)
      expect(running[0]!.name).toBe('shell')
      expect(running[0]!.ptyInstanceId).toBeTruthy()
    })

    it('starting a workenv-attached pod auto-starts the workenv if it is stopped', async () => {
      const proj = await client.workspace.create({ name: 'P', cwd: '/tmp' })
      const pod = await client.pod.create({ workspaceId: proj.id, name: 'pod', cwd: '/tmp' })
      await client.pod.addTerminal({ podId: pod.id, name: 'shell' })

      const w = await client.workenv.create({
        name: 'env',
        slug: 'env',
        config: { runtime: 'orbstack', worktreePath: '/tmp/env' },
      })
      // Workenv is in 'stopped' state (didn't start it explicitly).
      await client.pod.setWorkenv({ id: pod.id, workenvId: w.id })

      await client.pod.start({ id: pod.id })

      // Pod controller drives workenv.start before exec'ing terminals,
      // so the VM ends up running and the pod transitions to 'running'.
      const updatedWorkenv = await client.workenv.getById({ id: w.id })
      expect(updatedWorkenv!.state).toBe('running')
      const updated = await client.pod.getById({ id: pod.id })
      expect(updated!.status).toBe('running')
    })
  })

  // --- Plans ---

  describe('plan', () => {
    let workspaceId: string

    beforeEach(async () => {
      const w = await client.workspace.create({ name: 'plans-test', cwd: '/tmp' })
      workspaceId = w.id
    })

    it('create + getBySlug roundtrip with auto-slug', async () => {
      const plan = await client.plan.create({
        workspaceId,
        title: 'Auth Rework PRD',
        body: '# Goals\n\nReplace the legacy session middleware.\n',
      })
      expect(plan.slug).toBe('auth-rework-prd')
      expect(plan.kind).toBe('prd')
      expect(plan.status).toBe('active') // PRDs default to active
      expect(plan.version).toBe(1)

      const fetched = await client.plan.getBySlug({ workspaceId, slug: 'auth-rework-prd' })
      expect(fetched).toBeDefined()
      expect(fetched!.title).toBe('Auth Rework PRD')
      expect(fetched!.staleness.isStale).toBe(false)
      expect(fetched!.links).toEqual([])
    })

    it('proposal kind defaults to draft and reads as stale until reviewed', async () => {
      const plan = await client.plan.create({
        workspaceId,
        title: 'Cache invalidation',
        kind: 'proposal',
        author: { authorKind: 'agent', authorId: 'session-1' },
      })
      expect(plan.status).toBe('draft')
      const got = await client.plan.get({ id: plan.id })
      // Agent-authored draft: lastHumanReviewAt is null AND status != active.
      expect(got!.staleness.isStale).toBe(true)
      expect(got!.staleness.reason).toBe('inactive_status')
    })

    it('list excludes drafts/superseded by default', async () => {
      const a = await client.plan.create({ workspaceId, title: 'Active PRD' })
      await client.plan.create({ workspaceId, title: 'Draft', kind: 'proposal' })
      const list = await client.plan.list({ workspaceId })
      expect(list.map((p) => p.id)).toEqual([a.id])

      const all = await client.plan.list({ workspaceId, includeNonCanonical: true })
      expect(all).toHaveLength(2)
    })

    it('update enforces optimistic locking', async () => {
      const plan = await client.plan.create({ workspaceId, title: 'Lock test' })
      const updated = await client.plan.update({
        id: plan.id,
        expectedVersion: 1,
        body: '# Goals\n\nNew body.\n',
      })
      expect(updated.version).toBe(2)
      expect(updated.body).toContain('New body')

      // Stale write must fail (Effect wraps the throw as INTERNAL_SERVER_ERROR).
      await expect(client.plan.update({ id: plan.id, expectedVersion: 1, body: 'old client' })).rejects.toThrow()
      // The row didn't budge.
      const reread = await client.plan.get({ id: plan.id })
      expect(reread!.version).toBe(2)
      expect(reread!.body).toContain('New body')
    })

    it('appendNote merges into named section without conflict', async () => {
      const plan = await client.plan.create({
        workspaceId,
        title: 'AppendTest',
        body: '# Title\n\n## Goals\n\nA.\n',
      })
      const after = await client.plan.appendNote({
        id: plan.id,
        section: 'Goals',
        content: '- agent decision: use foo',
        author: { authorKind: 'agent', authorId: 'sess-1' },
      })
      expect(after.body).toContain('- agent decision: use foo')
      // Section that doesn't exist gets created at the bottom.
      const after2 = await client.plan.appendNote({
        id: plan.id,
        section: 'Decisions',
        content: 'pick A',
      })
      expect(after2.body).toMatch(/## Decisions[\s\S]*pick A/)
    })

    it('setStatus transitions and updates lastHumanReviewAt for user authors', async () => {
      const plan = await client.plan.create({ workspaceId, title: 'P' })
      const before = await client.plan.get({ id: plan.id })
      const completed = await client.plan.setStatus({ id: plan.id, status: 'completed' })
      expect(completed.status).toBe('completed')
      expect(completed.version).toBe(2)
      expect(completed.lastHumanReviewAt).toBeGreaterThanOrEqual(before!.lastHumanReviewAt ?? 0)
    })

    it('addLink is idempotent on (kind, refId) and stays even when the target is gone', async () => {
      const plan = await client.plan.create({ workspaceId, title: 'P' })
      const a = await client.plan.addLink({ planId: plan.id, kind: 'pod', refId: 'pod-1' })
      const b = await client.plan.addLink({ planId: plan.id, kind: 'pod', refId: 'pod-1' })
      expect(a.id).toBe(b.id)
      const links = await client.plan.listLinks({ planId: plan.id })
      expect(links).toHaveLength(1)
    })

    it('comments default includeInFeedback false for PRDs and true for review-loop plans', async () => {
      const prd = await client.plan.create({ workspaceId, title: 'PRD' })
      const c1 = await client.plan.addComment({ planId: prd.id, body: 'thought' })
      expect(c1.includeInFeedback).toBe(false)

      const proposal = await client.plan.create({
        workspaceId,
        title: 'Proposal',
        kind: 'proposal',
        submittedByChatSessionId: 'sess-7',
      })
      const c2 = await client.plan.addComment({ planId: proposal.id, body: 'feedback' })
      expect(c2.includeInFeedback).toBe(true)
    })

    it('listRevisions returns the create + each body update in newest-first order', async () => {
      const plan = await client.plan.create({ workspaceId, title: 'R', body: 'v1' })
      await client.plan.update({ id: plan.id, expectedVersion: 1, body: 'v2' })
      await client.plan.update({ id: plan.id, expectedVersion: 2, body: 'v3' })
      const revs = await client.plan.listRevisions({ planId: plan.id })
      expect(revs).toHaveLength(3)
      expect(revs[0]!.body).toBe('v3')
      expect(revs[2]!.summary).toBe('created')
    })

    it('submitForReview blocks until resolveReview returns the bundle', async () => {
      const sessionId = 'sess-review-1'

      // Kick off the blocking submit; we'll resolve it from a parallel branch.
      const submitPromise = client.plan.submitForReview({
        workspaceId,
        title: 'Build the auth rewrite',
        body: '# Plan\n\n## Goals\n\nReplace the legacy session middleware.\n',
        kind: 'proposal',
        submittedByChatSessionId: sessionId,
      })

      // Yield to the event loop so the submit's pending registration lands
      // before we look up the planId.
      await new Promise((r) => setTimeout(r, 30))

      // Find the freshly submitted plan via the list (drafts excluded by
      // default, so include non-canonical).
      const drafts = await client.plan.list({ workspaceId, includeNonCanonical: true })
      const submitted = drafts.find((p) => p.submittedByChatSessionId === sessionId && p.status === 'draft')
      expect(submitted).toBeDefined()
      const planId = submitted!.id

      // Add two comments — one default (auto-included since this is a
      // review-loop plan), one explicitly excluded.
      await client.plan.addComment({ planId, body: 'Tighten the token rotation policy.' })
      const c2 = await client.plan.addComment({ planId, body: 'Wording nit, ignore' })
      await client.plan.updateComment({ commentId: c2.id, includeInFeedback: false })

      const resolveResult = await client.plan.resolveReview({
        planId,
        decision: 'approved',
        userNote: 'Looks good, ship it.',
      })
      expect(resolveResult.resolved).toBe(true)
      expect(resolveResult.feedbackCount).toBe(1)

      const final = await submitPromise
      expect(final.planId).toBe(planId)
      expect(final.decision).toBe('approved')
      expect(final.userNote).toBe('Looks good, ship it.')
      expect(final.feedback).toHaveLength(1)
      expect(final.feedback[0]!.body).toContain('rotation policy')

      // Approval auto-promotes to active and stamps human-review timestamp.
      const after = await client.plan.get({ id: planId })
      expect(after!.status).toBe('active')
      expect(after!.lastHumanReviewAt).not.toBeNull()
    })

    it('changes_requested keeps the plan as draft for resubmission', async () => {
      const sessionId = 'sess-review-2'
      const submitPromise = client.plan.submitForReview({
        workspaceId,
        title: 'Ship caching layer',
        kind: 'task-plan',
        submittedByChatSessionId: sessionId,
      })
      await new Promise((r) => setTimeout(r, 30))

      const drafts = await client.plan.list({ workspaceId, includeNonCanonical: true })
      const submitted = drafts.find((p) => p.submittedByChatSessionId === sessionId)
      const planId = submitted!.id

      await client.plan.resolveReview({ planId, decision: 'changes_requested' })
      const final = await submitPromise
      expect(final.decision).toBe('changes_requested')

      const after = await client.plan.get({ id: planId })
      expect(after!.status).toBe('draft')
    })

    it('cascade deletes comments/links/revisions when the plan is removed', async () => {
      const plan = await client.plan.create({ workspaceId, title: 'C' })
      await client.plan.addComment({ planId: plan.id, body: 'x' })
      await client.plan.addLink({ planId: plan.id, kind: 'pod', refId: 'p-1' })
      await client.plan.delete({ id: plan.id })
      const found = await client.plan.get({ id: plan.id })
      expect(found).toBeNull()
      const remaining = await client.plan.listComments({ planId: plan.id })
      expect(remaining).toHaveLength(0)
    })
  })
})
