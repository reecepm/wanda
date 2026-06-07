// -----------------------------------------------------------------------------
// Smoke test for the Codex direct provider factory. Only exercises the
// manifest + detect() path; spawn() goes through real subprocess wiring
// which is covered separately by the gated real-binary integration.
// -----------------------------------------------------------------------------

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { CODEX_PROVIDER_ID, codexDirectProvider } from '../provider.ts'

describe('codexDirectProvider', () => {
  it('exposes a manifest with the Codex id + subprocess-stdio kind', () => {
    const p = codexDirectProvider()
    expect(p.manifest.id).toBe(CODEX_PROVIDER_ID)
    expect(p.manifest.kind).toBe('subprocess-stdio')
    expect(p.manifest.staticCapabilities.supportsSessionResume).toBe(true)
    expect(p.manifest.staticCapabilities.requiresLogin).toBe(true)
    expect(p.manifest.staticCapabilities.desktopOnly).toBe(true)
  })

  it('detect() reports available when a launchOverride is supplied', async () => {
    const p = codexDirectProvider({
      launchOverride: { command: '/usr/bin/env', args: ['true'] },
    })
    const env = {
      platform: 'node' as const,
      isSubprocess: false,
      cwd: '/tmp',
      env: {} as Record<string, string>,
      userDataDir: '/tmp',
    }
    const result = await Effect.runPromise(p.detect(env))
    expect(result.available).toBe(true)
  })
})
