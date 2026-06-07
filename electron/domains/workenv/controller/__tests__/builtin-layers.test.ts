import { describe, expect, it } from 'vitest'
import { workenvLayerSchema } from '../../../../../shared/contracts/workenv'
import { BUILTIN_LAYERS, BUILTIN_STARTER_TEMPLATES, getBuiltinLayer } from '../builtin-layers'

describe('BUILTIN_LAYERS catalog', () => {
  it('every layer parses against workenvLayerSchema', () => {
    for (const entry of BUILTIN_LAYERS) {
      const result = workenvLayerSchema.safeParse(entry.layer)
      if (!result.success) {
        // surface the offender in the failure message
        throw new Error(`Layer ${entry.layer.id} failed schema parse: ${result.error.message}`)
      }
    }
  })

  it('every layer has a unique id', () => {
    const ids = BUILTIN_LAYERS.map((e) => e.layer.id)
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(dupes).toEqual([])
  })

  it('every layer has a non-empty description', () => {
    for (const entry of BUILTIN_LAYERS) {
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('getBuiltinLayer returns the layer body for a known id', () => {
    expect(getBuiltinLayer('base:ubuntu-24')?.kind).toBe('base')
    expect(getBuiltinLayer('tool:bun')?.kind).toBe('tool')
    expect(getBuiltinLayer('does-not-exist')).toBeUndefined()
  })

  it('exposes parameterised tool layers (Node + Go) with default values', () => {
    const node = getBuiltinLayer('tool:node')
    expect(node?.kind).toBe('tool')
    if (node?.kind !== 'tool') return
    expect(node.params?.version).toBeDefined()

    const go = getBuiltinLayer('tool:go')
    expect(go?.kind).toBe('tool')
    if (go?.kind !== 'tool') return
    expect(go.params?.version).toBeDefined()
  })

  it('ships at least one layer per kind (services excluded — host-side execution TBD)', () => {
    const kinds = new Set(BUILTIN_LAYERS.map((e) => e.layer.kind))
    expect(kinds.has('base')).toBe(true)
    expect(kinds.has('pkg')).toBe(true)
    expect(kinds.has('tool')).toBe(true)
    expect(kinds.has('auth')).toBe(true)
  })

  it('exposes project bootstrap CLIs as selectable tool layers', () => {
    const ids = BUILTIN_LAYERS.map((e) => e.layer.id)
    expect(ids).toContain('tool:task')
    expect(ids).toContain('tool:encore')
  })

  it('links Encore into a PATH directory for non-login shells', () => {
    const encore = getBuiltinLayer('tool:encore')
    expect(encore?.kind).toBe('tool')
    if (encore?.kind !== 'tool') return
    expect(encore.install.map((s) => s.run).join('\n')).toContain('/usr/local/bin/encore')
  })

  it('marks a strong default set so a fresh template/workenv is preselected', () => {
    const defaults = BUILTIN_LAYERS.filter((e) => e.default).map((e) => e.layer.id)
    // First boot should be reliable: base essentials plus low-risk auth
    // symlinks. Network-heavy language/tool installers stay opt-in.
    expect(defaults).toEqual(['base:ubuntu-24', 'auth:git', 'auth:ssh', 'auth:gh'])
  })

  it('uses the Ubuntu 24.04-compatible ALSA package in browser deps', () => {
    const browserDeps = getBuiltinLayer('pkg:browser-deps')
    expect(browserDeps?.kind).toBe('pkg')
    if (browserDeps?.kind !== 'pkg') return
    expect(browserDeps.packages).toContain('libasound2t64')
    expect(browserDeps.packages).not.toContain('libasound2')
  })

  it('keeps host-socket Docker separate from the in-VM Docker Engine layer', () => {
    const docker = getBuiltinLayer('tool:docker')
    expect(docker?.kind).toBe('tool')
    if (docker?.kind !== 'tool') return
    const combined = docker.install.map((s) => s.run).join('\n')
    expect(combined).not.toMatch(/get\.docker\.com|apt-get install .*docker|dockerd/)
    expect(combined).toMatch(/orbstack-guest\/run\/docker\.sock/)

    const dockerEngine = getBuiltinLayer('tool:docker-engine')
    expect(dockerEngine?.kind).toBe('tool')
    if (dockerEngine?.kind !== 'tool') return
    const engineInstall = dockerEngine.install.map((s) => s.run).join('\n')
    expect(engineInstall).toMatch(/apt-get install .*docker-ce/)
    expect(engineInstall).toMatch(/service docker start/)
  })

  it('Go default version tracks the current toolchain', () => {
    const go = getBuiltinLayer('tool:go')
    expect(go?.kind).toBe('tool')
    if (go?.kind !== 'tool') return
    expect(go.params?.version).toBe('1.26.0')
  })

  it('every base layer bakes in dev essentials so users do not have to add curl/git/etc.', () => {
    for (const entry of BUILTIN_LAYERS.filter((e) => e.layer.kind === 'base')) {
      if (entry.layer.kind !== 'base') continue
      expect(entry.layer.install, `${entry.layer.id} should ship default install steps`).toBeDefined()
      const combined = (entry.layer.install ?? []).map((s) => s.run).join(' ')
      for (const must of ['curl', 'git', 'ca-certificates', 'build-essential']) {
        expect(combined, `${entry.layer.id} install missing ${must}`).toContain(must)
      }
    }
  })
})

describe('BUILTIN_STARTER_TEMPLATES', () => {
  it('ships no bundled starter templates — users compose their own', () => {
    expect(BUILTIN_STARTER_TEMPLATES).toEqual([])
  })
})
