import { readFileSync } from 'node:fs'
import type { WorkenvBootstrapStep, WorkenvConfig } from '../../../../shared/contracts/workenv'
import type { ExecRequest } from '../types/adapter'

export function bootstrapStepName(step: WorkenvBootstrapStep): string {
  if (step.kind !== 'recipe' && step.label) return step.label
  switch (step.kind) {
    case 'shell':
      return `shell: ${step.run}`
    case 'script':
      return `script: ${step.path}`
    case 'hostScript':
      return `host script: ${step.path}`
    case 'recipe':
      return `recipe: ${step.ref}`
  }
}

export function plainEnv(env: WorkenvConfig['env']): Record<string, string> {
  if (!env) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

export function interpolate(input: string, env: Record<string, string>): string {
  return input.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    return env[name] ?? match
  })
}

export function execRequestForBootstrapStep(step: WorkenvBootstrapStep, env: Record<string, string>): ExecRequest {
  if (step.kind === 'shell') {
    return {
      cmd: '/bin/sh',
      args: ['-c', interpolate(step.run, env)],
      env,
      pty: false,
      runAs: step.asUser ?? 'root',
      cwd: step.cwd ? interpolate(step.cwd, env) : undefined,
    }
  }
  if (step.kind === 'script') {
    return {
      cmd: '/bin/sh',
      args: [interpolate(step.path, env)],
      env,
      pty: false,
      runAs: step.asUser ?? 'root',
      cwd: step.cwd ? interpolate(step.cwd, env) : undefined,
    }
  }
  if (step.kind === 'hostScript') {
    const scriptPath = interpolate(step.path, env)
    const encoded = Buffer.from(readFileSync(scriptPath, 'utf8'), 'utf8').toString('base64')
    return {
      cmd: '/bin/sh',
      args: ['-c', `printf %s ${shellQuote(encoded)} | base64 -d | /bin/sh`],
      env,
      pty: false,
      runAs: step.asUser ?? 'root',
      cwd: step.cwd ? interpolate(step.cwd, env) : undefined,
    }
  }
  throw new Error(`recipe steps are not implemented in v1 (ref: ${step.ref})`)
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:+@=,%]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'"'"'`)}'`
}
