import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { injectCodexHooks } from './inject-codex'

describe('injectCodexHooks', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wanda-codex-hooks-'))
    dirs.push(dir)
    return dir
  }

  it('writes the documented hooks.json shape and enables codex_hooks', () => {
    const cwd = tempWorkspace()

    injectCodexHooks(cwd)

    const hooks = JSON.parse(readFileSync(join(cwd, '.codex', 'hooks.json'), 'utf-8'))
    expect(hooks).toHaveProperty('hooks.Stop')
    expect(hooks.hooks.Stop[0].hooks[0]).toMatchObject({ type: 'command' })
    expect(hooks.Stop).toBeUndefined()

    const config = readFileSync(join(cwd, '.codex', 'config.toml'), 'utf-8')
    expect(config).toContain('[features]')
    expect(config).toContain('codex_hooks = true')
  })

  it('migrates old top-level Wanda hook arrays into hooks.*', () => {
    const cwd = tempWorkspace()
    const codexDir = join(cwd, '.codex')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(
      join(codexDir, 'hooks.json'),
      JSON.stringify({
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: '/old' }], __wanda_managed: true }],
      }),
    )

    const cleanup = injectCodexHooks(cwd)
    const injected = JSON.parse(readFileSync(join(codexDir, 'hooks.json'), 'utf-8'))
    expect(injected.Stop).toBeUndefined()
    expect(injected.hooks.Stop[0].hooks[0]).toMatchObject({ type: 'command' })

    cleanup()

    const hooks = JSON.parse(readFileSync(join(codexDir, 'hooks.json'), 'utf-8'))
    expect(hooks.Stop).toBeUndefined()
    expect(hooks.hooks).toBeUndefined()
  })
})
