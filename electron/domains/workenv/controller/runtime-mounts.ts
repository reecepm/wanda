import { homedir } from 'node:os'
import type { WorkenvBootstrapStep, WorkenvConfig, WorkenvMount } from '../../../../shared/contracts/workenv'
import type { RuntimeCapabilities } from '../types/adapter'

/**
 * Compiles host mounts for the `auto-host-home` sharing model, where the
 * runtime exposes host files inside the guest at their original absolute path
 * (OrbStack today). A workenv "mount" is therefore a guest-side link from the
 * requested destination to that shared host path. Runtimes with other sharing
 * models handle mounts at the adapter level and yield no bootstrap steps here.
 */
export function compileRuntimeMountSteps(
  config: WorkenvConfig,
  fsSharingModel: RuntimeCapabilities['fsSharingModel'],
  opts: { hostHome?: string } = {},
): WorkenvBootstrapStep[] {
  if (fsSharingModel !== 'auto-host-home') return []

  const hostHome = opts.hostHome ?? homedir()
  const seen = new Set<string>()
  const steps: WorkenvBootstrapStep[] = []

  for (const mount of config.mounts ?? []) {
    const key = mountKey(mount, hostHome)
    if (!key || seen.has(key)) continue
    seen.add(key)

    if (mount.kind === 'cache') {
      steps.push({
        kind: 'shell',
        run: `mkdir -p ${shellQuote(mount.guest)}`,
      })
      continue
    }

    const hostPath = expandHostPath(mount.host, hostHome)
    if (!hostPath) continue

    steps.push({
      kind: 'shell',
      run: [
        `host=${shellQuote(hostPath)}`,
        `guest=${shellQuote(mount.guest)}`,
        `mode=${shellQuote(mount.mode)}`,
        'case "$guest" in /*) ;; *) echo "guest mount path must be absolute: $guest" >&2; exit 64;; esac',
        'case "$host" in /*) ;; *) echo "host mount path must be absolute: $host" >&2; exit 64;; esac',
        'mkdir -p "$(dirname "$guest")"',
        'if [ -L "$guest" ] && [ "$(readlink "$guest")" = "$host" ]; then exit 0; fi',
        'backup="/tmp/wanda-mount-backups/$(printf %s "$guest" | cksum | awk \'{print $1}\')"',
        'if [ -L "$guest" ]; then rm "$guest"; elif [ -e "$guest" ]; then if rmdir "$guest" 2>/dev/null; then :; elif [ "$mode" = rw ]; then if [ -d "$guest" ]; then mkdir -p "$host" && cp -a "$guest/." "$host/" && rm -rf "$guest"; else mkdir -p "$(dirname "$host")" && { [ -e "$host" ] || cp -a "$guest" "$host"; } && rm -f "$guest"; fi; else mkdir -p "$(dirname "$backup")" && if [ ! -e "$backup" ]; then mv "$guest" "$backup"; else rm -rf "$guest"; fi; fi; fi',
        'ln -s "$host" "$guest"',
      ].join(' && '),
    })
  }

  return steps
}

function expandHostPath(host: string | undefined, hostHome: string): string | undefined {
  if (!host) return undefined
  if (host === '~') return hostHome
  if (host.startsWith('~/')) return `${hostHome}${host.slice(1)}`
  return host
}

function mountKey(mount: WorkenvMount, hostHome: string): string | undefined {
  if (mount.kind === 'cache') return `mount:cache:${stableHash(`${mount.cacheKey ?? ''}:${mount.guest}`)}`
  const hostPath = expandHostPath(mount.host, hostHome)
  if (!hostPath) return undefined
  return `mount:bind:${stableHash(`${hostPath}:${mount.guest}:${mount.mode}`)}`
}

function stableHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(31, h) + input.charCodeAt(i)
    h |= 0
  }
  return h.toString(16).padStart(8, '0')
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./:+@=,%]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'"'"'`)}'`
}
