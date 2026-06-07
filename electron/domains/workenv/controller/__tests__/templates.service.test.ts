import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Layer, ManagedRuntime } from 'effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkenvConfig } from '../../../../../shared/contracts/workenv'
import { runMigrations } from '../../../../db/migrate'
import * as schema from '../../../../db/schema'
import * as taskSchema from '../../../../db/task-schema'
import { DatabaseService } from '../../../../infra/database'
import { mergeWorkenvConfig, WorkenvTemplates, WorkenvTemplatesLive } from '../templates'

function setup() {
  const dbLayer = Layer.sync(DatabaseService, () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema: { ...schema, ...taskSchema } })
    runMigrations(db, join(__dirname, '../../../../db/migrations'))
    return db
  })
  const layer = WorkenvTemplatesLive.pipe(Layer.provideMerge(dbLayer))
  return { runtime: ManagedRuntime.make(layer) }
}

describe('mergeWorkenvConfig', () => {
  it('user override wins on scalars', () => {
    const template: Partial<WorkenvConfig> = { runtime: 'orbstack', worktreePath: '/template' }
    const override: WorkenvConfig = { runtime: 'orbstack', worktreePath: '/user' }
    const merged = mergeWorkenvConfig(template, override)
    expect(merged.runtime).toBe('orbstack')
    expect(merged.worktreePath).toBe('/user')
  })

  it('concatenates arrays (mounts, layers, ports, prebuild, bootstrap, postStart, requires)', () => {
    const template: Partial<WorkenvConfig> = {
      runtime: 'orbstack',
      mounts: [{ guest: '/a', mode: 'rw', kind: 'bind' }],
      layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
      ports: [{ name: 'a', guest: 1, host: 'auto', protocol: 'tcp' }],
      prebuild: [{ kind: 'shell', run: 'pre-a' }],
      bootstrap: [{ kind: 'shell', run: 'a' }],
      postStart: [{ kind: 'shell', run: 'post-a' }],
      requires: ['compose'],
    }
    const override: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/u',
      mounts: [{ guest: '/b', mode: 'ro', kind: 'bind' }],
      layers: [
        {
          kind: 'tool',
          id: 'tool:task',
          name: 'Task',
          install: [{ run: 'echo task' }],
        },
      ],
      ports: [{ name: 'b', guest: 2, host: 'auto', protocol: 'tcp' }],
      prebuild: [{ kind: 'shell', run: 'pre-b' }],
      bootstrap: [{ kind: 'shell', run: 'b' }],
      postStart: [{ kind: 'shell', run: 'post-b' }],
      requires: ['ssh'],
    }
    const merged = mergeWorkenvConfig(template, override)
    expect(merged.mounts).toHaveLength(2)
    expect(merged.layers?.map((l) => l.id)).toEqual(['base:ubuntu-24', 'tool:task'])
    expect(merged.ports).toHaveLength(2)
    expect(merged.prebuild?.map((s) => (s.kind === 'shell' ? s.run : '?'))).toEqual(['pre-a', 'pre-b'])
    expect(merged.bootstrap).toHaveLength(2)
    expect(merged.postStart?.map((s) => (s.kind === 'shell' ? s.run : '?'))).toEqual(['post-a', 'post-b'])
    expect(merged.requires).toEqual(['compose', 'ssh'])
  })

  it('shallow-merges record fields (env, base, resources)', () => {
    const template: Partial<WorkenvConfig> = {
      runtime: 'orbstack',
      env: { TEMPLATE_VAR: 'tval', SHARED: 'template' },
      base: { image: 'ubuntu:22.04' },
      resources: { cpus: 2 },
    }
    const override: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/u',
      env: { USER_VAR: 'uval', SHARED: 'user' },
      base: { arch: 'arm64' },
      resources: { memoryMB: 8192 },
    }
    const merged = mergeWorkenvConfig(template, override)
    expect(merged.env).toEqual({ TEMPLATE_VAR: 'tval', USER_VAR: 'uval', SHARED: 'user' })
    expect(merged.base).toEqual({ image: 'ubuntu:22.04', arch: 'arm64' })
    expect(merged.resources).toEqual({ cpus: 2, memoryMB: 8192 })
  })

  it('user healthcheck/workdir replaces template entirely (no merge)', () => {
    const template: Partial<WorkenvConfig> = {
      runtime: 'orbstack',
      healthcheck: { cmd: 'template', intervalSec: 5, startPeriodSec: 0 },
      workdir: '/template',
    }
    const override: WorkenvConfig = {
      runtime: 'orbstack',
      worktreePath: '/u',
      healthcheck: { cmd: 'user', intervalSec: 10, startPeriodSec: 1 },
    }
    const merged = mergeWorkenvConfig(template, override)
    expect(merged.healthcheck?.cmd).toBe('user')
    // No workdir override → falls back to template's.
    expect(merged.workdir).toBe('/template')
  })

  it('handles missing arrays/records gracefully', () => {
    const merged = mergeWorkenvConfig({}, { runtime: 'orbstack', worktreePath: '/u' })
    expect(merged.runtime).toBe('orbstack')
    expect(merged.worktreePath).toBe('/u')
    expect(merged.mounts).toBeUndefined()
    expect(merged.ports).toBeUndefined()
  })
})

describe('WorkenvTemplates service', () => {
  let runtime: ReturnType<typeof setup>['runtime']
  beforeEach(() => {
    ;({ runtime } = setup())
  })

  it('list / get / create / update / delete round-trip', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    expect(await runtime.runPromise(svc.list())).toEqual([])

    const t = await runtime.runPromise(
      svc.create({ name: 'Ubuntu 24', runtime: 'orbstack', config: { runtime: 'orbstack' } }),
    )
    expect(t.id).toBeTruthy()

    const list = await runtime.runPromise(svc.list())
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('Ubuntu 24')

    const got = await runtime.runPromise(svc.getById(t.id))
    expect(got?.name).toBe('Ubuntu 24')

    const updated = await runtime.runPromise(svc.update(t.id, { name: 'Ubuntu 24 LTS' }))
    expect(updated.name).toBe('Ubuntu 24 LTS')

    await runtime.runPromise(svc.delete(t.id))
    expect(await runtime.runPromise(svc.list())).toEqual([])
  })

  it('exports and imports a shareable YAML definition', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const original = await runtime.runPromise(
      svc.create({
        id: 'team-stack',
        name: 'Team stack',
        description: 'Shared setup',
        runtime: 'orbstack',
        config: {
          layers: [
            {
              kind: 'tool',
              id: 'tool:task',
              name: 'Task',
              install: [{ run: 'echo install task' }],
            },
          ],
          env: { TOOL_HOME: '/opt/tool' },
        },
      }),
    )

    const yaml = await runtime.runPromise(svc.exportYaml(original.id))
    expect(yaml).toContain('kind: wanda.workenv.template')
    expect(yaml).toContain('version: 1')
    expect(yaml).toContain('id: team-stack')

    await runtime.runPromise(svc.delete(original.id))
    const imported = await runtime.runPromise(svc.importYaml(yaml))

    expect(imported.id).toBe('team-stack')
    expect(imported.name).toBe('Team stack')
    expect(imported.description).toBe('Shared setup')
    expect(imported.config.env).toEqual({ TOOL_HOME: '/opt/tool' })
    expect(imported.config.layers?.[0]?.id).toBe('tool:task')
  })

  it('imports matching YAML IDs as copies unless replaceExisting is set', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const existing = await runtime.runPromise(
      svc.create({
        id: 'existing-stack',
        name: 'Existing',
        runtime: 'orbstack',
        config: { env: { VALUE: 'old' } },
      }),
    )
    const yaml = [
      'kind: wanda.workenv.template',
      'version: 1',
      'id: existing-stack',
      'name: Replacement',
      'runtime: orbstack',
      'config:',
      '  env:',
      '    VALUE: new',
      '',
    ].join('\n')

    const copy = await runtime.runPromise(svc.importYaml(yaml))
    expect(copy.id).not.toBe(existing.id)
    expect(copy.name).toBe('Replacement')
    expect((await runtime.runPromise(svc.getById(existing.id)))?.config.env).toEqual({ VALUE: 'old' })

    const replaced = await runtime.runPromise(svc.importYaml(yaml, { replaceExisting: true }))
    expect(replaced.id).toBe(existing.id)
    expect(replaced.name).toBe('Replacement')
    expect(replaced.config.env).toEqual({ VALUE: 'new' })
  })

  it('does not allow YAML import to replace built-in templates', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    await runtime.runPromise(
      svc.create({
        id: 'builtin:locked',
        name: 'Locked',
        runtime: 'orbstack',
        config: {},
        builtIn: true,
      }),
    )
    const yaml = [
      'kind: wanda.workenv.template',
      'version: 1',
      'id: builtin:locked',
      'name: Replacement',
      'runtime: orbstack',
      'config: {}',
      '',
    ].join('\n')

    const copy = await runtime.runPromise(svc.importYaml(yaml))
    expect(copy.id).not.toBe('builtin:locked')

    const result = await runtime.runPromise(svc.importYaml(yaml, { replaceExisting: true })).catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/cannot replace built-in template/)
  })

  it('rejects invalid workenv template YAML before writing to the database', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const result = await runtime
      .runPromise(
        svc.importYaml(
          ['kind: wanda.workenv.template', 'version: 1', 'name: Bad', 'runtime: docker', 'config: {}', ''].join('\n'),
        ),
      )
      .catch((e) => e as Error)

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/invalid workenv template YAML/)
    expect(await runtime.runPromise(svc.list())).toEqual([])
  })

  it('rejects unknown top-level YAML fields', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const result = await runtime
      .runPromise(
        svc.importYaml(
          [
            'kind: wanda.workenv.template',
            'version: 1',
            'name: Bad',
            'runtime: orbstack',
            'surprise: nope',
            'config: {}',
            '',
          ].join('\n'),
        ),
      )
      .catch((e) => e as Error)

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/unknown field: surprise/)
    expect(await runtime.runPromise(svc.list())).toEqual([])
  })

  it('rejects unknown nested config fields', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const result = await runtime
      .runPromise(
        svc.importYaml(
          [
            'kind: wanda.workenv.template',
            'version: 1',
            'name: Bad',
            'runtime: orbstack',
            'config:',
            '  runtime: orbstack',
            '  bootstrappp: []',
            '',
          ].join('\n'),
        ),
      )
      .catch((e) => e as Error)

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/unknown field: config.bootstrappp/)
    expect(await runtime.runPromise(svc.list())).toEqual([])
  })

  it('compile() resolves a one-level extends chain into the user config', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const t = await runtime.runPromise(
      svc.create({
        name: 'With ports',
        runtime: 'orbstack',
        config: {
          runtime: 'orbstack',
          layers: [{ kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04' }],
          ports: [{ name: 'web', guest: 3000, host: 'auto', protocol: 'tcp' }],
        },
      }),
    )

    const compiled = await runtime.runPromise(
      svc.compile({
        runtime: 'orbstack',
        worktreePath: '/tmp/mine',
        extends: [t.id],
        layers: [
          {
            kind: 'tool',
            id: 'tool:task',
            name: 'Task',
            install: [{ run: 'echo task' }],
          },
        ],
        ports: [{ name: 'pg', guest: 5432, host: 5433, protocol: 'tcp' }],
      }),
    )

    expect(compiled.layers?.map((l) => l.id)).toEqual(['base:ubuntu-24', 'tool:task'])
    expect(compiled.ports?.map((p) => p.name)).toEqual(['web', 'pg'])
    expect(compiled.worktreePath).toBe('/tmp/mine')
  })

  it('compile() with no extends returns the user config unchanged', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const compiled = await runtime.runPromise(svc.compile({ runtime: 'orbstack', worktreePath: '/tmp/x' }))
    expect(compiled).toEqual({ runtime: 'orbstack', worktreePath: '/tmp/x' })
  })

  it('compile() rejects an unknown template ref', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)
    const result = await runtime
      .runPromise(svc.compile({ runtime: 'orbstack', worktreePath: '/u', extends: ['missing-id'] }))
      .catch((e) => e as Error)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/missing-id/)
  })

  it('seedBuiltIns() is a no-op today (no bundled starter templates)', async () => {
    const svc = await runtime.runPromise(WorkenvTemplates)

    await runtime.runPromise(svc.seedBuiltIns())
    const first = await runtime.runPromise(svc.list())
    expect(first.filter((t) => t.builtIn)).toEqual([])

    // Idempotent — re-seed, still empty.
    await runtime.runPromise(svc.seedBuiltIns())
    const second = await runtime.runPromise(svc.list())
    expect(second.filter((t) => t.builtIn)).toEqual([])
  })
})
