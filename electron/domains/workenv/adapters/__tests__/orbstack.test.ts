// -----------------------------------------------------------------------------
// OrbstackAdapter unit tests. Mocked CLI runner — no real orb calls. The
// skip-guarded integration suite lives next door in `orbstack.int.test.ts`.
// -----------------------------------------------------------------------------

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { PtyServiceShape } from '../../../../services/pty.service'
import type { WorkenvHandle } from '../../types/adapter'
import { OrbstackAdapter } from '../orbstack'
import { AdapterError, type CliOutcome, type CliRunner } from '../shared'

interface CliCall {
  readonly cmd: string
  readonly args: readonly string[]
}

/**
 * Programmable CLI runner. Tests push outcomes keyed by `[cmd, arg0]` so
 * specific command shapes get custom responses; unmatched calls return a
 * success+empty default.
 */
function makeFakeRunner() {
  const calls: CliCall[] = []
  const outcomes = new Map<string, CliOutcome | AdapterError>()

  const runner: CliRunner = (cmd, args) =>
    Effect.suspend(() => {
      calls.push({ cmd, args: [...args] })
      const key = `${cmd} ${args[0] ?? ''}`
      const hit = outcomes.get(key)
      if (hit instanceof AdapterError) return Effect.fail(hit)
      return Effect.succeed(hit ?? { code: 0, stdout: '', stderr: '' })
    })

  return {
    runner,
    calls,
    set(cmd: string, sub: string, outcome: CliOutcome | AdapterError) {
      outcomes.set(`${cmd} ${sub}`, outcome)
    },
  }
}

function makeAdapter(homeDir = '/Users/alice') {
  const fake = makeFakeRunner()
  const adapter = new OrbstackAdapter({ runner: fake.runner, homeDir })
  return { adapter, ...fake }
}

describe('OrbstackAdapter', () => {
  describe('identity + capabilities', () => {
    it('id is orbstack and version is populated', () => {
      const { adapter } = makeAdapter()
      expect(adapter.id).toBe('orbstack')
      expect(typeof adapter.version).toBe('string')
    })

    it('declares OrbStack capability shape (auto-host-home, silent-drop, resources NOT enforced)', () => {
      const { adapter } = makeAdapter()
      const caps = adapter.capabilities()
      expect(caps.fsSharingModel).toBe('auto-host-home')
      expect(caps.portCollisionBehaviour).toBe('silent-drop')
      expect(caps.resourcesEnforced).toBe(false)
      expect(caps.networking).toBe(true)
      expect(caps.portPublishing).toBe(true)
      expect(caps.supportsSnapshot).toBe(false)
      expect(caps.overheadMBApprox).toBeGreaterThan(0)
    })
  })

  describe('probe', () => {
    it('reports available when `orbctl version` succeeds and status is Running', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'version', {
        code: 0,
        stdout: 'Version: 2.0.5 (2000500)\nCommit: abc (v2.0.5)\n',
        stderr: '',
      })
      set('orbctl', 'status', { code: 0, stdout: 'Running\n', stderr: '' })

      const result = await Effect.runPromise(adapter.probe())
      expect(result.available).toBe(true)
      expect(result.version).toMatch(/2\.0\.5/)
    })

    it('reports unavailable with error when orb binary is missing', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'version', new AdapterError('orbctl not found on PATH', 'not-installed'))

      const result = await Effect.runPromise(adapter.probe())
      expect(result.available).toBe(false)
      expect(result.error).toMatch(/not found|not-installed|missing/i)
    })

    it('reports unavailable when orbctl status is not Running', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'version', { code: 0, stdout: 'Version: 2.0.5\n', stderr: '' })
      set('orbctl', 'status', { code: 1, stdout: 'Stopped\n', stderr: '' })

      const result = await Effect.runPromise(adapter.probe())
      expect(result.available).toBe(false)
    })
  })

  describe('create', () => {
    it('calls orbctl create with arch and VM name wanda-<slug>', async () => {
      const { adapter, calls } = makeAdapter()
      const handle = await Effect.runPromise(
        adapter.create({
          slug: 'demo',
          config: { runtime: 'orbstack', worktreePath: '/Users/alice/code/demo' },
        }),
      )

      expect(handle.adapterHandle).toBe('wanda-demo')
      expect(handle.runtime).toBe('orbstack')
      expect(handle.state).toEqual({
        runtime: 'orbstack',
        vmName: 'wanda-demo',
        arch: 'arm64',
      })

      const createCall = calls.find((c) => c.cmd === 'orbctl' && c.args[0] === 'create')
      expect(createCall).toBeDefined()
      expect(createCall!.args).toContain('-a')
      expect(createCall!.args).toContain('arm64')
      expect(createCall!.args).toContain('ubuntu')
      expect(createCall!.args).toContain('wanda-demo')
    })

    it('honours custom arch from config.base.arch', async () => {
      const { adapter, calls } = makeAdapter()
      await Effect.runPromise(
        adapter.create({
          slug: 'amd64-demo',
          config: {
            runtime: 'orbstack',
            worktreePath: '/Users/alice/code/demo',
            base: { arch: 'amd64' },
          },
        }),
      )
      const createCall = calls.find((c) => c.args[0] === 'create')
      expect(createCall!.args).toContain('amd64')
    })

    it('honours custom distro from config.base.image', async () => {
      const { adapter, calls } = makeAdapter()
      await Effect.runPromise(
        adapter.create({
          slug: 'fedora',
          config: {
            runtime: 'orbstack',
            worktreePath: '/Users/alice/code/fedora',
            base: { image: 'fedora' },
          },
        }),
      )
      const createCall = calls.find((c) => c.args[0] === 'create')
      expect(createCall!.args).toContain('fedora')
    })

    it('rejects worktreePath outside $HOME with invalid-config error', async () => {
      const { adapter } = makeAdapter('/Users/alice')
      const result = await Effect.runPromise(
        Effect.either(
          adapter.create({
            slug: 'bad',
            config: { runtime: 'orbstack', worktreePath: '/tmp/outside-home' },
          }),
        ),
      )
      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        const err = result.left as AdapterError
        expect(err.kind).toBe('invalid-config')
        expect(err.message).toMatch(/\$?HOME|worktree|outside/i)
      }
    })

    it('rejects when resources.cpus/memoryMB/diskGB set (OrbStack ignores)', async () => {
      const { adapter } = makeAdapter()
      const result = await Effect.runPromise(
        Effect.either(
          adapter.create({
            slug: 'with-res',
            config: {
              runtime: 'orbstack',
              worktreePath: '/Users/alice/code/x',
              resources: { cpus: 4 },
            },
          }),
        ),
      )
      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect((result.left as AdapterError).kind).toBe('invalid-config')
        expect(result.left.message).toMatch(/resource|cpu|memory|disk/i)
      }
    })

    it('surfaces CLI failure from orbctl create', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'create', { code: 1, stdout: '', stderr: 'already exists' })
      const result = await Effect.runPromise(
        Effect.either(
          adapter.create({
            slug: 'dup',
            config: { runtime: 'orbstack', worktreePath: '/Users/alice/code/dup' },
          }),
        ),
      )
      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect((result.left as AdapterError).kind).toBe('cli-failed')
        expect(result.left.message).toMatch(/already exists|create/i)
      }
    })
  })

  describe('start/stop/destroy', () => {
    const handle: WorkenvHandle = {
      runtime: 'orbstack',
      adapterHandle: 'wanda-demo',
      state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
    }

    it('start calls `orbctl start <name>`', async () => {
      const { adapter, calls } = makeAdapter()
      await Effect.runPromise(adapter.start(handle))
      const call = calls.find((c) => c.args[0] === 'start')
      expect(call).toBeDefined()
      expect(call!.args).toContain('wanda-demo')
    })

    it('stop calls `orbctl stop <name>`', async () => {
      const { adapter, calls } = makeAdapter()
      await Effect.runPromise(adapter.stop(handle))
      const call = calls.find((c) => c.args[0] === 'stop')
      expect(call).toBeDefined()
      expect(call!.args).toContain('wanda-demo')
    })

    it('destroy calls `orbctl delete -f <name>`', async () => {
      const { adapter, calls } = makeAdapter()
      await Effect.runPromise(adapter.destroy(handle))
      const call = calls.find((c) => c.args[0] === 'delete')
      expect(call).toBeDefined()
      expect(call!.args).toContain('wanda-demo')
      // -f to avoid interactive prompt.
      expect(call!.args.some((a) => a === '-f' || a === '--force')).toBe(true)
    })

    it('start surfaces AdapterError on non-zero exit', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'start', { code: 1, stdout: '', stderr: 'machine not found' })
      const result = await Effect.runPromise(Effect.either(adapter.start(handle)))
      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect((result.left as AdapterError).kind).toBe('cli-failed')
      }
    })

    it('destroy treats "not found" as a soft success (idempotent)', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'delete', { code: 1, stdout: '', stderr: 'no such machine: wanda-demo' })
      // Should not throw — destroy is best-effort.
      await expect(Effect.runPromise(adapter.destroy(handle))).resolves.toBeUndefined()
    })

    it('clone calls `orbctl clone <source> wanda-<slug>` and returns a stopped handle', async () => {
      const { adapter, calls } = makeAdapter()
      const cloned = await Effect.runPromise(
        adapter.clone!(handle, {
          slug: 'copy',
          config: {
            runtime: 'orbstack',
            worktreePath: '/Users/alice/project-copy',
            base: { image: 'ubuntu', arch: 'arm64' },
          },
        }),
      )

      const call = calls.find((c) => c.args[0] === 'clone')
      expect(call).toBeDefined()
      expect(call!.args).toEqual(['clone', 'wanda-demo', 'wanda-copy'])
      expect(cloned.adapterHandle).toBe('wanda-copy')
      expect(cloned.state.runtime).toBe('orbstack')
    })
  })

  describe('list / status', () => {
    it('list() parses orbctl list --format json and filters to wanda-* handles', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'list', {
        code: 0,
        stdout: JSON.stringify([
          {
            id: '01K0',
            name: 'wanda-demo',
            image: { distro: 'ubuntu', version: 'questing', arch: 'arm64', variant: 'default' },
            state: 'running',
            builtin: false,
          },
          {
            id: '01K1',
            name: 'other-vm',
            image: { distro: 'ubuntu', version: 'questing', arch: 'arm64', variant: 'default' },
            state: 'stopped',
            builtin: false,
          },
          {
            id: '01K2',
            name: 'wanda-stopped',
            image: { distro: 'debian', version: 'trixie', arch: 'amd64', variant: 'default' },
            state: 'stopped',
            builtin: false,
          },
        ]),
        stderr: '',
      })

      const handles = await Effect.runPromise(adapter.list())
      const names = handles.map((h) => h.adapterHandle).sort()
      expect(names).toEqual(['wanda-demo', 'wanda-stopped'])
      const stopped = handles.find((h) => h.adapterHandle === 'wanda-stopped')!
      expect(stopped.state.runtime).toBe('orbstack')
      if (stopped.state.runtime === 'orbstack') {
        expect(stopped.state.arch).toBe('amd64')
      }
    })

    it('list() returns [] when orbctl returns an empty array', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'list', { code: 0, stdout: '[]', stderr: '' })
      const handles = await Effect.runPromise(adapter.list())
      expect(handles).toEqual([])
    })

    it('status() returns running=true when the VM exists and is running', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'info', {
        code: 0,
        stdout: JSON.stringify({
          record: {
            id: '01K',
            name: 'wanda-demo',
            image: { distro: 'ubuntu', version: 'questing', arch: 'arm64', variant: 'default' },
            state: 'running',
            builtin: false,
          },
          disk_size: 0,
        }),
        stderr: '',
      })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }
      const status = await Effect.runPromise(adapter.status(handle))
      expect(status.running).toBe(true)
    })

    it('status() returns running=false when state is not running', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'info', {
        code: 0,
        stdout: JSON.stringify({
          record: { name: 'wanda-demo', state: 'stopped', image: { arch: 'arm64' } },
          disk_size: 0,
        }),
        stderr: '',
      })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }
      const status = await Effect.runPromise(adapter.status(handle))
      expect(status.running).toBe(false)
    })

    it('status() surfaces a not-found error when orbctl info fails with code 1', async () => {
      const { adapter, set } = makeAdapter()
      set('orbctl', 'info', { code: 1, stdout: '', stderr: 'no such machine' })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-ghost',
        state: { runtime: 'orbstack', vmName: 'wanda-ghost', arch: 'arm64' },
      }
      const result = await Effect.runPromise(Effect.either(adapter.status(handle)))
      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect((result.left as AdapterError).kind).toBe('not-found')
      }
    })
  })

  describe('exec', () => {
    it('exec throws if no PtyService is provided (config error)', () => {
      const { adapter } = makeAdapter()
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }
      expect(() => adapter.exec(handle, { cmd: 'true', pty: true })).toThrowError(/pty/i)
    })

    it('exec spawns via PtyService with `orbctl run -m <vm>` and returns a session with an id', async () => {
      const ptyCalls: Array<{ command: string; args: readonly string[] }> = []
      const exitHandlers = new Map<string, (id: string, code: number) => void>()
      const dataSubscribers = new Set<(id: string, data: string) => void>()
      const subscribed: string[] = []
      const acked: Array<{ id: string; bytes: number }> = []
      let nextId = 0
      const pty = {
        create: (cfg: { command: string; args?: readonly string[]; onExit?: (id: string, code: number) => void }) =>
          Effect.sync(() => {
            const id = `pty-${++nextId}`
            ptyCalls.push({ command: cfg.command, args: cfg.args ?? [] })
            if (cfg.onExit) exitHandlers.set(id, cfg.onExit)
            return id
          }),
        write: (_id: string, _data: string) => {},
        resize: (_id: string, _cols: number, _rows: number) => {},
        destroy: (_id: string) => Effect.sync(() => {}),
        onAnyData: (cb: (id: string, data: string) => void) => {
          dataSubscribers.add(cb)
          return () => dataSubscribers.delete(cb)
        },
        subscribe: (id: string) => {
          subscribed.push(id)
        },
        unsubscribe: (_id: string) => {},
        ack: (id: string, bytes: number) => {
          acked.push({ id, bytes })
        },
      }
      const adapter = new OrbstackAdapter({ runner: makeFakeRunner().runner, pty: pty as unknown as PtyServiceShape })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }

      const session = adapter.exec(handle, {
        cmd: 'ls',
        args: ['-la'],
        cwd: '/Users/alice/code/demo',
        pty: true,
      })

      expect(session.id).toMatch(/^pty-/)
      expect(ptyCalls).toHaveLength(1)
      const call = ptyCalls[0]!
      expect(call.command).toBe('orbctl')
      // orbctl run -m <vm> bash -lc '...'
      expect(call.args).toContain('run')
      expect(call.args).toContain('-m')
      expect(call.args).toContain('wanda-demo')
      // No -u flag when runAs is unset — orbctl maps the host user.
      expect(call.args).not.toContain('-u')
      // bash -lc wrapper with `cd <workdir> && exec <cmd>`
      const inner = call.args[call.args.length - 1]
      expect(inner).toMatch(/cd \/Users\/alice\/code\/demo/)
      expect(inner).toMatch(/exec ls -la/)
      expect(subscribed).toEqual([session.id])

      const chunks: string[] = []
      session.onData((chunk) => chunks.push(chunk))
      for (const cb of dataSubscribers) cb(session.id, 'hello')
      expect(chunks).toEqual(['hello'])
      expect(acked).toEqual([{ id: session.id, bytes: 5 }])
    })

    it('injects ExecRequest env into the guest command', () => {
      const ptyCalls: Array<{ command: string; args: readonly string[] }> = []
      const pty = {
        create: (cfg: { command: string; args?: readonly string[] }) =>
          Effect.sync(() => {
            ptyCalls.push({ command: cfg.command, args: cfg.args ?? [] })
            return 'pty-1'
          }),
        write: () => {},
        resize: () => {},
        destroy: () => Effect.sync(() => {}),
        onAnyData: () => () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        ack: () => {},
      }
      const adapter = new OrbstackAdapter({ runner: makeFakeRunner().runner, pty: pty as unknown as PtyServiceShape })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }

      adapter.exec(handle, {
        cmd: '/bin/bash',
        cwd: '/Users/alice/code/demo',
        env: {
          TOOL_HOME: '/usr/local/lib/tool',
          VALUE_WITH_SPACE: 'hello world',
        },
        pty: true,
      })

      const innerArgs = ptyCalls[0]!.args
      const inner = innerArgs[innerArgs.length - 1]
      expect(inner).toContain('exec env TOOL_HOME=/usr/local/lib/tool')
      expect(inner).toContain("'VALUE_WITH_SPACE=hello world'")
      expect(inner).toContain('/bin/bash')
    })

    it('threads runAs into the orbctl spawn args (PTY path)', () => {
      const ptyCalls: Array<{ command: string; args: readonly string[] }> = []
      const pty = {
        create: (cfg: { command: string; args?: readonly string[] }) =>
          Effect.sync(() => {
            ptyCalls.push({ command: cfg.command, args: cfg.args ?? [] })
            return 'pty-1'
          }),
        write: () => {},
        resize: () => {},
        destroy: () => Effect.sync(() => {}),
        onAnyData: () => () => {},
        subscribe: () => {},
        unsubscribe: () => {},
        ack: () => {},
      }
      const adapter = new OrbstackAdapter({ runner: makeFakeRunner().runner, pty: pty as unknown as PtyServiceShape })
      const handle: WorkenvHandle = {
        runtime: 'orbstack',
        adapterHandle: 'wanda-demo',
        state: { runtime: 'orbstack', vmName: 'wanda-demo', arch: 'arm64' },
      }

      adapter.exec(handle, { cmd: 'apt-get', args: ['update'], pty: true, runAs: 'root' })

      const args = ptyCalls[0]!.args
      const uIdx = args.indexOf('-u')
      expect(uIdx).toBeGreaterThan(-1)
      expect(args[uIdx + 1]).toBe('root')
    })
  })
})
