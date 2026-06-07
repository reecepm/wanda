// Build editor deep-link URLs.
//
// The goal is to let wanda hand the user's local editor an SSH-remote URL
// so the editor handles authentication itself (via the user's ssh-agent)
// rather than wanda ever touching credentials. For local workspaces we
// fall back to `file://`.
//
//   cursor://vscode-remote/ssh-remote+<user>@<host>(:<port>)/<absolutePath>
//
// Cursor and VS Code both understand this scheme; Zed has its own
// `zed://ssh/<user>@<host>/<path>` form that we can add later.

export interface SshEditorTarget {
  readonly host: string
  readonly user?: string
  readonly port?: number
}

export function buildEditorUrl(workspaceCwd: string, ssh: SshEditorTarget | null): string {
  const path = workspaceCwd && workspaceCwd.length > 0 ? workspaceCwd : '/'
  if (!ssh) {
    return `file://${path}`
  }
  const hostWithPort = ssh.port && ssh.port !== 22 ? `${ssh.host}:${ssh.port}` : ssh.host
  const target = ssh.user ? `${ssh.user}@${hostWithPort}` : hostWithPort
  return `cursor://vscode-remote/ssh-remote+${target}${path}`
}
