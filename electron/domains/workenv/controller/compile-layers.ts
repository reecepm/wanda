// -----------------------------------------------------------------------------
// compileLayers — turn `WorkenvConfig.layers[]` into a flat config the
// adapter / bootstrap-runner already understands. Layers are an authoring
// abstraction; the rest of the system continues to consume (base, mounts,
// ports, env, bootstrap).
//
// Merge rules:
//   - base: last `base` layer wins; `config.base` (user override) wins on top
//   - mounts/ports/env: layers contribute first, then user-set fields appended
//     (or for env, layers first then user keys win on conflict)
//   - bootstrap: layer-derived steps run BEFORE user-authored steps so the
//     environment is set up before any user smoke-test
//
// Idempotency keys are auto-derived from layer.id when not provided so a
// `tool:bun` re-run is a no-op even if the user adds or removes other layers.
// -----------------------------------------------------------------------------

import type {
  WorkenvBootstrapStep,
  WorkenvConfig,
  WorkenvEnvValue,
  WorkenvLayer,
  WorkenvLayerShellStep,
  WorkenvMount,
  WorkenvPort,
} from '../../../../shared/contracts/workenv'

interface CompiledLayers {
  readonly base?: { image: string; arch?: 'arm64' | 'amd64' }
  readonly bootstrap: readonly WorkenvBootstrapStep[]
  readonly mounts: readonly WorkenvMount[]
  readonly ports: readonly WorkenvPort[]
  readonly env: Readonly<Record<string, WorkenvEnvValue>>
}

export function compileLayers(layers: readonly WorkenvLayer[]): CompiledLayers {
  let base: CompiledLayers['base']
  const bootstrap: WorkenvBootstrapStep[] = []
  const mounts: WorkenvMount[] = []
  const ports: WorkenvPort[] = []
  const env: Record<string, WorkenvEnvValue> = {}

  for (const layer of layers) {
    switch (layer.kind) {
      case 'base':
        base = { image: layer.image, arch: layer.arch }
        ;(layer.install ?? []).forEach((step, i) => {
          bootstrap.push(toShellStep(step, `${layer.id}:install:${i}`, undefined))
        })
        break

      case 'pkg': {
        const cmd =
          layer.manager === 'apt'
            ? `apt-get update && apt-get install -y ${layer.packages.join(' ')}`
            : `apk add --no-cache ${layer.packages.join(' ')}`
        bootstrap.push({
          kind: 'shell',
          run: cmd,
          idempotencyKey: `${layer.id}:install:${stableHash(cmd)}`,
        })
        break
      }

      case 'tool': {
        layer.install.forEach((step, i) => {
          bootstrap.push(toShellStep(step, `${layer.id}:install:${i}`, layer.params))
        })
        break
      }

      case 'service': {
        // Service layers are declarations for future orchestration. For now,
        // they contribute ports/env for UI and config round-tripping, but do
        // not start containers or processes implicitly.
        for (const p of layer.ports ?? []) ports.push(p)
        for (const [k, v] of Object.entries(layer.env ?? {})) {
          if (!(k in env)) env[k] = v
        }
        break
      }

      case 'auth': {
        for (const m of layer.mounts ?? []) mounts.push(m)
        for (const [k, v] of Object.entries(layer.env ?? {})) {
          if (!(k in env)) env[k] = v
        }
        for (const [k, hostCmd] of Object.entries(layer.resolveEnv ?? {})) {
          env[k] = { fromHost: hostCmd }
        }
        // resolveFiles compile to a deferred step that the controller
        // materialises on the host side at start-time. We emit a marker
        // shell step so the order is preserved relative to other layers.
        for (const [path, hostCmd] of Object.entries(layer.resolveFiles ?? {})) {
          bootstrap.push({
            kind: 'shell',
            run: `# resolveFile ${path}: ${hostCmd}`,
            idempotencyKey: `${layer.id}:resolveFile:${path}`,
          })
        }
        break
      }

      case 'shell': {
        layer.steps.forEach((step, i) => {
          bootstrap.push(toShellStep(step, `${layer.id}:step:${i}`, undefined))
        })
        break
      }
    }
  }

  return { base, bootstrap, mounts, ports, env }
}

export function compileLayerRuntimeChecks(layers: readonly WorkenvLayer[]): readonly WorkenvBootstrapStep[] {
  const checks: WorkenvBootstrapStep[] = []
  for (const layer of layers) {
    if (layer.kind !== 'tool') continue
    ;(layer.verify ?? []).forEach((step, i) => {
      checks.push(toShellStep(step, `${layer.id}:verify:${i}`, layer.params, { autoIdempotencyKey: false }))
    })
  }
  return checks
}

/**
 * Apply compiled layers to a WorkenvConfig, producing the flat shape the
 * rest of the system consumes. User-authored fields win over layer output
 * so the manual escape hatch is always available.
 *
 * `bootstrap` is INTENTIONALLY not merged here: layer-derived bootstrap
 * steps are recomputed fresh at workenv start time (see startImpl), so
 * catalog improvements (new layers, fixed install scripts) automatically
 * flow into existing workenvs without a manual migration. `config.bootstrap`
 * stays as the user's authored escape-hatch list.
 */
export function applyCompiledLayers(config: WorkenvConfig): WorkenvConfig {
  if (!config.layers || config.layers.length === 0) return config
  const compiled = compileLayers(config.layers)

  const mergedMounts = [...compiled.mounts, ...(config.mounts ?? [])]
  const mergedPorts = [...compiled.ports, ...(config.ports ?? [])]
  const mergedEnv = { ...compiled.env, ...(config.env ?? {}) }

  return {
    ...config,
    base: config.base ?? compiled.base,
    mounts: mergedMounts.length > 0 ? mergedMounts : config.mounts,
    ports: mergedPorts.length > 0 ? mergedPorts : config.ports,
    env: Object.keys(mergedEnv).length > 0 ? mergedEnv : config.env,
    // bootstrap pass-through — fresh-compiled at start time.
  }
}

// --- internals -------------------------------------------------------------

function toShellStep(
  step: WorkenvLayerShellStep,
  fallbackKey: string,
  params: Record<string, string> | undefined,
  opts?: { autoIdempotencyKey?: boolean },
): WorkenvBootstrapStep {
  const interpolated = params ? interpolateParams(step.run, params) : step.run
  // `asUser` wraps the command via `sudo -u <user> -i bash -lc '<run>'`.
  // Layers default to root because most package installs need it; the
  // tool-layer authors mark `asUser` for things like Bun that
  // install into the user's home dir.
  const run = step.asUser ? `sudo -u ${shellQuote(step.asUser)} -i bash -lc ${shellQuote(interpolated)}` : interpolated
  return {
    kind: 'shell',
    run,
    idempotencyKey:
      step.idempotencyKey ?? (opts?.autoIdempotencyKey === false ? undefined : `${fallbackKey}:${stableHash(run)}`),
  }
}

function interpolateParams(input: string, params: Record<string, string>): string {
  return input.replace(/\$\{param\.([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    return params[name] ?? match
  })
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:+@=,%]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'"'"'`)}'`
}

function stableHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(31, h) + input.charCodeAt(i)
    h |= 0
  }
  return h.toString(16).padStart(8, '0')
}
