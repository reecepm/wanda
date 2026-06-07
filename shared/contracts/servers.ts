// -----------------------------------------------------------------------------
// Server-registry + local-server contracts.
//
// Types exposed to the renderer describing paired remote servers and the
// embedded local server's bind state. Defined in shared/contracts because
// both the renderer (TanStack hooks, Machines page) and the Electron main
// process (preload API, ServerRegistry) consume them.
// -----------------------------------------------------------------------------

/** Paired-server record shape exposed to the renderer. Mirrors ServerRegistry.list(). */
export interface PairedServerView {
  readonly id: string
  readonly serverId: string
  readonly label: string
  readonly baseUrl: string
  readonly addedAt: number
  readonly lastConnectedAt: number | null
}

/** Snapshot of the embedded server's bind + identity for the Machines page. */
export interface LocalServerInfo {
  readonly listenHost: string
  readonly port: number
  readonly serverId: string
  readonly hostname: string
  readonly networkHosts: readonly string[]
  /** True when bound to a non-loopback host, i.e. reachable from other machines. */
  readonly exposed: boolean
}

/** Result of minting a fresh pairing URL from the embedded server. */
export interface LocalPairingUrl {
  readonly url: string
  readonly expiresAt: number
}
