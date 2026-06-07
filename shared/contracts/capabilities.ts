// -----------------------------------------------------------------------------
// Server capability descriptor.
//
// Returned from `GET /api/capabilities`. Clients read this once per paired
// server (refreshed on reconnect) and branch their UI on it — e.g. "Open in
// Cursor" builds a `cursor://vscode-remote/ssh-remote+<ssh>` URL, "Reveal
// in Finder" is hidden when `ssh !== null`, etc.
// -----------------------------------------------------------------------------

export interface SshDescriptor {
  readonly host: string
  readonly user: string
  readonly port?: number
  /** Absolute path on the server machine where workspaces live. */
  readonly workspacePath: string
}

export interface ServerFeatures {
  readonly docker: boolean
  readonly agents: boolean
  readonly workspaceRoot: string
}

export interface ServerCapabilities {
  readonly serverId: string
  readonly hostname: string
  readonly appVersion: string
  /** Null when the server cannot be reached via SSH (e.g. laptop-local). */
  readonly ssh: SshDescriptor | null
  readonly features: ServerFeatures
}
