// -----------------------------------------------------------------------------
// Curated catalog of built-in layers shipped with Wanda.
//
// Layer ids are stable so user configs that reference them survive upgrades.
// Authoring intent: every common dev stack should be expressible as
// `[base:*, tool:*, tool:*, auth:*, service:*]` without writing shell.
//
// The catalog is exposed via the workenv router so the renderer's layer
// picker has something to populate from on day one. Users can add custom
// layers (workenv_layers table) to extend.
// -----------------------------------------------------------------------------

import type { WorkenvLayer } from '../../../../shared/contracts/workenv'

interface BuiltinLayerEntry {
  readonly layer: WorkenvLayer
  readonly description: string
  /**
   * When true, this layer is preselected when the user creates a fresh
   * workenv or template. Keep this set boot-reliable: base essentials plus
   * cheap auth links. Network-heavy runtimes should stay opt-in.
   */
  readonly default?: boolean
}

// --- base layers -----------------------------------------------------------
//
// Bases ship with the universal essentials baked in (curl, git, build deps,
// ca-certs, etc.) so picking a base alone is a usable starting point. Users
// only add `pkg:` layers for stack-specific extras.

const APT_ESSENTIALS = [
  'apt-transport-https',
  'build-essential',
  'ca-certificates',
  'curl',
  'git',
  'gnupg',
  'jq',
  'less',
  'lsb-release',
  'pkg-config',
  'ripgrep',
  'sudo',
  'unzip',
  'vim',
  'wget',
]

const aptEssentialsInstall = [
  {
    run: `apt-get update && apt-get install -y ${APT_ESSENTIALS.join(' ')} && rm -rf /var/lib/apt/lists/*`,
  },
  {
    // Create a non-root user so layers that install per-user
    // (Bun, Rust via rustup, Claude Code, ...) have a stable home dir.
    // Idempotent: if useradd fails because the user exists, we ignore it.
    run: 'id -u wanda >/dev/null 2>&1 || useradd -m -s /bin/bash wanda',
  },
  {
    // Passwordless sudo for the non-root user. Some install scripts
    // shell out to apt or symlink into /usr/local/bin and need root.
    run: `mkdir -p /etc/sudoers.d && echo 'wanda ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/wanda && chmod 440 /etc/sudoers.d/wanda`,
  },
]

const BASE_LAYERS: BuiltinLayerEntry[] = [
  {
    description: 'Ubuntu 24.04 LTS + dev essentials (curl, git, build deps, jq, ripgrep, …).',
    default: true,
    layer: {
      kind: 'base',
      id: 'base:ubuntu-24',
      image: 'ubuntu:24.04',
      arch: 'arm64',
      install: aptEssentialsInstall,
    },
  },
  {
    description: 'Ubuntu 22.04 LTS + dev essentials.',
    layer: {
      kind: 'base',
      id: 'base:ubuntu-22',
      image: 'ubuntu:22.04',
      arch: 'arm64',
      install: aptEssentialsInstall,
    },
  },
  {
    description: 'Debian 12 (Bookworm), slim variant + dev essentials.',
    layer: {
      kind: 'base',
      id: 'base:debian-12',
      image: 'debian:12-slim',
      arch: 'arm64',
      install: aptEssentialsInstall,
    },
  },
]

// --- pkg layers ------------------------------------------------------------
//
// Stack-specific extras only — the universal essentials (curl, git, build
// deps, ca-certs, jq, ripgrep, …) ship inside the base layers so users
// don't have to add them.

const PKG_LAYERS: BuiltinLayerEntry[] = [
  {
    description: 'libssl + libffi headers (needed for some Python/Rust crates).',
    layer: {
      kind: 'pkg',
      id: 'pkg:ssl-ffi-headers',
      manager: 'apt',
      packages: ['libssl-dev', 'libffi-dev'],
    },
  },
  {
    description: 'PostgreSQL client tools (psql, pg_dump, pg_restore).',
    layer: {
      kind: 'pkg',
      id: 'pkg:postgresql-client',
      manager: 'apt',
      packages: ['postgresql-client'],
    },
  },
  {
    description: 'GUI/headless browser deps (Playwright, Puppeteer).',
    layer: {
      kind: 'pkg',
      id: 'pkg:browser-deps',
      manager: 'apt',
      packages: [
        'libnss3',
        'libnspr4',
        'libatk1.0-0',
        'libatk-bridge2.0-0',
        'libcups2',
        'libdrm2',
        'libxkbcommon0',
        'libxcomposite1',
        'libxdamage1',
        'libxfixes3',
        'libxrandr2',
        'libgbm1',
        'libpango-1.0-0',
        'libcairo2',
        // Ubuntu 24.04 replaced libasound2 with the t64 package.
        'libasound2t64',
      ],
    },
  },
]

// --- tool layers (parameterised where it makes sense) ---------------------

const TOOL_LAYERS: BuiltinLayerEntry[] = [
  {
    description: 'Node.js via NodeSource (parameterise version: 20/22/24).',
    layer: {
      kind: 'tool',
      id: 'tool:node',
      name: 'Node ${param.version}',
      params: { version: '24' },
      install: [
        {
          run: 'curl -fsSL https://deb.nodesource.com/setup_${param.version}.x | bash - && apt-get install -y nodejs',
        },
        {
          run: 'corepack enable',
        },
      ],
    },
  },
  {
    description: 'Bun (installs to ~/.bun, symlinked into /usr/local/bin).',
    layer: {
      kind: 'tool',
      id: 'tool:bun',
      name: 'Bun',
      install: [
        {
          run: 'curl -fsSL https://bun.sh/install | bash',
          asUser: 'wanda',
        },
        {
          run: 'ln -sf /home/wanda/.bun/bin/bun /usr/local/bin/bun && ln -sf /home/wanda/.bun/bin/bunx /usr/local/bin/bunx',
        },
      ],
    },
  },
  {
    description: 'pnpm via Corepack (requires tool:node).',
    layer: {
      kind: 'tool',
      id: 'tool:pnpm',
      name: 'pnpm',
      install: [{ run: 'corepack prepare pnpm@latest --activate' }],
    },
  },
  {
    description: 'Python 3 + pip + venv.',
    layer: {
      kind: 'tool',
      id: 'tool:python-3',
      name: 'Python 3',
      install: [
        {
          run: 'apt-get update && apt-get install -y python3 python3-pip python3-venv && rm -rf /var/lib/apt/lists/*',
        },
      ],
    },
  },
  {
    description: 'Go (parameterise version, default 1.26).',
    layer: {
      kind: 'tool',
      id: 'tool:go',
      name: 'Go ${param.version}',
      params: { version: '1.26.0' },
      install: [
        {
          run: 'curl -fsSL https://go.dev/dl/go${param.version}.linux-arm64.tar.gz | tar -C /usr/local -xz && ln -sf /usr/local/go/bin/go /usr/local/bin/go && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt',
        },
      ],
    },
  },
  {
    description: 'Taskfile CLI (`task`) installed via Go into /usr/local/bin.',
    layer: {
      kind: 'tool',
      id: 'tool:task',
      name: 'Taskfile CLI',
      install: [
        {
          run: 'GOBIN=/usr/local/bin go install github.com/go-task/task/v3/cmd/task@latest',
        },
      ],
    },
  },
  {
    description: 'Encore CLI, installed under /usr/local/lib and linked into /usr/local/bin.',
    layer: {
      kind: 'tool',
      id: 'tool:encore',
      name: 'Encore CLI',
      install: [
        {
          run: "export ENCORE_INSTALL=/usr/local/lib/encore && curl -fsSL https://encore.dev/install.sh | bash && chmod -R a+rX /usr/local/lib/encore && rm -f /usr/local/bin/encore && printf '%s\\n' '#!/bin/sh' 'export ENCORE_INSTALL=/usr/local/lib/encore' 'export ENCORE_RUNTIMES_PATH=/usr/local/lib/encore/runtimes' 'exec /usr/local/lib/encore/bin/encore \"$@\"' > /usr/local/bin/encore && chmod +x /usr/local/bin/encore && ln -sf /usr/local/lib/encore/bin/git-remote-encore /usr/local/bin/git-remote-encore && ln -sf /usr/local/lib/encore/bin/tsbundler-encore /usr/local/bin/tsbundler-encore && ln -sf /usr/local/lib/encore/bin/tsparser-encore /usr/local/bin/tsparser-encore && command -v encore && encore version",
        },
      ],
      verify: [
        {
          run: "[ -d /usr/local/lib/encore/runtimes ] || (export ENCORE_INSTALL=/usr/local/lib/encore && curl -fsSL https://encore.dev/install.sh | bash) && chmod -R a+rX /usr/local/lib/encore && rm -f /usr/local/bin/encore && printf '%s\\n' '#!/bin/sh' 'export ENCORE_INSTALL=/usr/local/lib/encore' 'export ENCORE_RUNTIMES_PATH=/usr/local/lib/encore/runtimes' 'exec /usr/local/lib/encore/bin/encore \"$@\"' > /usr/local/bin/encore && chmod +x /usr/local/bin/encore && command -v encore && encore version",
        },
      ],
    },
  },
  {
    description: 'Rust via rustup (stable toolchain, ~/.cargo/bin symlinked into /usr/local/bin).',
    layer: {
      kind: 'tool',
      id: 'tool:rust',
      name: 'Rust',
      install: [
        {
          run: 'curl --proto =https --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain stable',
          asUser: 'wanda',
        },
        {
          run: 'for bin in cargo rustc rustup rustfmt clippy-driver; do ln -sf /home/wanda/.cargo/bin/$bin /usr/local/bin/$bin; done',
        },
      ],
    },
  },
  {
    description: 'GitHub CLI (gh).',
    layer: {
      kind: 'tool',
      id: 'tool:gh',
      name: 'GitHub CLI',
      install: [
        {
          run: 'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
        },
        {
          run: 'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
        },
        {
          run: 'apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*',
        },
      ],
    },
  },
  {
    description: 'Claude Code CLI (native binary, non-root).',
    layer: {
      kind: 'tool',
      id: 'tool:claude-code',
      name: 'Claude Code',
      install: [
        {
          run: 'curl -fsSL https://claude.ai/install.sh | bash && sudo ln -sf ~/.local/bin/claude /usr/local/bin/claude',
          asUser: 'wanda',
        },
        {
          run: 'mkdir -p ~/.claude && echo \'{"bypassPermissionsModeAccepted":true}\' > ~/.claude/settings.json',
          asUser: 'wanda',
        },
      ],
    },
  },
  {
    description: 'Docker is provided by the host OrbStack engine; no in-VM bootstrap required.',
    layer: {
      kind: 'tool',
      id: 'tool:docker',
      name: 'Docker CLI',
      install: [
        {
          run: 'if [ -S /opt/orbstack-guest/run/docker.sock ]; then ln -sf /opt/orbstack-guest/run/docker.sock /var/run/docker.sock && chmod a+rw /opt/orbstack-guest/run/docker.sock; fi; command -v docker && docker version',
        },
      ],
      verify: [
        {
          run: 'if [ -S /opt/orbstack-guest/run/docker.sock ]; then ln -sf /opt/orbstack-guest/run/docker.sock /var/run/docker.sock && chmod a+rw /opt/orbstack-guest/run/docker.sock; fi; command -v docker && docker version',
        },
      ],
    },
  },
  {
    description: 'Docker Engine running inside the VM for tools that require localhost-published ports.',
    layer: {
      kind: 'tool',
      id: 'tool:docker-engine',
      name: 'Docker Engine',
      install: [
        {
          run: 'install -m 0755 -d /etc/apt/keyrings && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && chmod a+r /etc/apt/keyrings/docker.asc && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && rm -rf /var/lib/apt/lists/* && (systemctl enable docker || true) && service docker start && chmod a+rw /var/run/docker.sock && docker version',
        },
      ],
      verify: [
        {
          run: 'service docker start && chmod a+rw /var/run/docker.sock && command -v docker && docker version',
        },
      ],
    },
  },
]

// --- auth layers ----------------------------------------------------------

const AUTH_LAYERS: BuiltinLayerEntry[] = [
  {
    description: 'Mount ~/.gitconfig from host.',
    default: true,
    layer: {
      kind: 'auth',
      id: 'auth:git',
      name: 'Git config',
      mounts: [{ host: '~/.gitconfig', guest: '/root/.gitconfig', mode: 'ro', kind: 'bind' }],
    },
  },
  {
    description: 'Mount SSH keys read-only into the VM.',
    default: true,
    layer: {
      kind: 'auth',
      id: 'auth:ssh',
      name: 'SSH keys',
      mounts: [{ host: '~/.ssh', guest: '/root/.ssh', mode: 'ro', kind: 'bind' }],
    },
  },
  {
    description: 'Mount GitHub CLI credentials.',
    default: true,
    layer: {
      kind: 'auth',
      id: 'auth:gh',
      name: 'GitHub CLI auth',
      mounts: [{ host: '~/.config/gh', guest: '/root/.config/gh', mode: 'ro', kind: 'bind' }],
    },
  },
  {
    description: 'Persist Claude Code auth across VM restarts.',
    layer: {
      kind: 'auth',
      id: 'auth:claude',
      name: 'Claude Code auth',
      mounts: [{ host: '~/.claude', guest: '/home/wanda/.claude', mode: 'rw', kind: 'bind' }],
    },
  },
]

// --- service layers --------------------------------------------------------
//
// No catalog services right now. Service layers need a real orchestrator
// before they can safely start long-running dependencies.

const SERVICE_LAYERS: BuiltinLayerEntry[] = []

export const BUILTIN_LAYERS: ReadonlyArray<BuiltinLayerEntry> = [
  ...BASE_LAYERS,
  ...PKG_LAYERS,
  ...TOOL_LAYERS,
  ...AUTH_LAYERS,
  ...SERVICE_LAYERS,
]

/** Look up a built-in layer by id (returns the layer body, not the entry). */
export function getBuiltinLayer(id: string): WorkenvLayer | undefined {
  return BUILTIN_LAYERS.find((e) => e.layer.id === id)?.layer
}

// --- starter templates (compose layers) -----------------------------------

import type { WorkenvConfig } from '../../../../shared/contracts/workenv'

interface BuiltinTemplateEntry {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly runtime: 'orbstack'
  readonly config: Partial<WorkenvConfig>
  readonly sortOrder: number
}

function tplLayers(ids: string[]): WorkenvLayer[] {
  const out: WorkenvLayer[] = []
  for (const id of ids) {
    const layer = getBuiltinLayer(id)
    if (layer) out.push(layer)
  }
  return out
}

// No bundled starter templates. The user composes their own from the layer
// catalog — opinionated stacks too easily go stale or pick the wrong stack.
// The catalog itself is the day-one fallback.
export const BUILTIN_STARTER_TEMPLATES: ReadonlyArray<BuiltinTemplateEntry> = []

// Kept for callers; will become unused once the helper is removed alongside.
void tplLayers
