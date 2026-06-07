// -----------------------------------------------------------------------------
// Workenv templates: no bundled starters today (users compose their own from
// the layer catalog), but custom templates persist and a workenv created with
// inline `layers[]` compiles into the flat (base/bootstrap/ports/env) shape.
// -----------------------------------------------------------------------------

import { expect, test } from './fixtures'

type WandaAPI = {
  rpc: { call: (path: string[], input: unknown) => Promise<unknown> }
}

interface WorkenvTemplate {
  id: string
  name: string
  runtime: 'orbstack'
  builtIn: boolean
  config: Record<string, unknown>
}

interface WorkenvRow {
  id: string
  templateId: string | null
  runtime: 'orbstack'
  runtimeState?: { runtime: 'orbstack'; prebuildHash?: string }
  config: {
    runtime: 'orbstack'
    worktreePath: string
    layers?: Array<{ kind: string; id: string }>
    bootstrap?: Array<{ kind: string; run?: string; idempotencyKey?: string }>
    base?: { image?: string; arch?: string }
    ports?: Array<{ name: string; guest: number }>
  }
}

interface WorkenvPrebuildResult {
  templateId: string
  hash: string
  adapterHandle: string
}

test('no built-in templates are seeded on boot', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const templates = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    return (await w.wanda.rpc.call(['workenv', 'listTemplates'], {})) as WorkenvTemplate[]
  })

  expect(templates.filter((t) => t.builtIn)).toEqual([])
})

test('create workenv with inline layers: layers compile into base + bootstrap + ports', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const result = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }

    const layers = [
      { kind: 'base', id: 'base:ubuntu-24', image: 'ubuntu:24.04', arch: 'arm64' },
      { kind: 'pkg', id: 'pkg:common', manager: 'apt', packages: ['curl', 'git'] },
      {
        kind: 'service',
        id: 'service:postgres-17',
        name: 'pg',
        image: 'postgres:17',
        ports: [{ name: 'postgres', guest: 5432, host: 'auto', protocol: 'tcp' }],
      },
    ]

    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'e2e-layered',
      slug: 'e2e-layered',
      config: {
        runtime: 'orbstack',
        worktreePath: '/tmp/e2e-layered',
        layers,
      },
    })) as WorkenvRow

    return { wrk }
  })

  expect(result.wrk.runtime).toBe('orbstack')
  expect(result.wrk.config.base).toEqual({ image: 'ubuntu:24.04', arch: 'arm64' })
  // Layer kept as authored for round-trip editing.
  expect(result.wrk.config.layers?.length).toBe(3)
  // Bootstrap is NOT persisted on create — it's compiled fresh at start
  // so catalog improvements flow into existing workenvs.
  expect(result.wrk.config.bootstrap).toBeUndefined()
  // service layer's port surfaced into config.ports.
  expect(result.wrk.config.ports?.find((p) => p.name === 'postgres')?.guest).toBe(5432)
})

test('createTemplate persists a custom template visible via listTemplates', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const result = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const created = (await w.wanda.rpc.call(['workenv', 'createTemplate'], {
      name: 'Custom e2e template',
      description: 'Created from an e2e spec',
      runtime: 'orbstack',
      config: {
        bootstrap: [{ kind: 'shell', run: 'echo ready', idempotencyKey: 'e2e-custom-bootstrap' }],
      },
    })) as WorkenvTemplate
    const list = (await w.wanda.rpc.call(['workenv', 'listTemplates'], {})) as WorkenvTemplate[]
    return { created, visible: list.find((t) => t.id === created.id) }
  })

  expect(result.created.builtIn).toBe(false)
  expect(result.visible).toBeDefined()
  expect(result.visible!.name).toBe('Custom e2e template')
})

test('manual template prebuild is reused by later pod-style workenv creation', async ({ wandaFake }) => {
  const page = wandaFake.mainWindow

  const result = await page.evaluate(async () => {
    const w = window as unknown as { wanda: WandaAPI }
    const layers = [
      {
        kind: 'base',
        id: 'base:ubuntu-24',
        image: 'ubuntu:24.04',
        arch: 'arm64',
        install: [{ run: 'echo base', idempotencyKey: 'e2e-base' }],
      },
      {
        kind: 'tool',
        id: 'tool:node',
        name: 'Node ${param.version}',
        params: { version: '24' },
        install: [{ run: 'echo node-${param.version}', idempotencyKey: 'e2e-node' }],
      },
    ]
    const tpl = (await w.wanda.rpc.call(['workenv', 'createTemplate'], {
      name: 'Prebuild reuse e2e',
      runtime: 'orbstack',
      config: { layers },
    })) as WorkenvTemplate

    const prebuild = (await w.wanda.rpc.call(['workenv', 'prebuildTemplate'], {
      id: tpl.id,
    })) as WorkenvPrebuildResult

    const wrk = (await w.wanda.rpc.call(['workenv', 'create'], {
      name: 'prebuild-reuse-workenv',
      slug: 'prebuild-reuse-workenv',
      templateId: tpl.id,
      config: {
        runtime: 'orbstack',
        worktreePath: '/tmp/prebuild-reuse-workenv',
        layers: [
          {
            install: [{ idempotencyKey: 'e2e-base', run: 'echo base' }],
            arch: 'arm64',
            image: 'ubuntu:24.04',
            id: 'base:ubuntu-24',
            kind: 'base',
          },
          {
            install: [{ idempotencyKey: 'e2e-node', run: 'echo node-${param.version}' }],
            params: { version: '24' },
            name: 'Node ${param.version}',
            id: 'tool:node',
            kind: 'tool',
          },
        ],
      },
    })) as WorkenvRow

    return { prebuild, wrk }
  })

  expect(result.wrk.runtimeState?.prebuildHash).toBe(result.prebuild.hash)
})
