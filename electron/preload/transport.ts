// -----------------------------------------------------------------------------
// Preload transport abstraction.
//
// Defines the single interface that the `createWandaApi()` factory uses to
// talk to the server. Both the Electron IPC path and the WebSocket path
// implement this interface, so `window.wanda` ends up identical regardless
// of where it runs (Electron renderer / standalone browser).
//
// This file is runtime-safe to import from both Electron preload (which
// adds IPC) and a pure-browser entry (which only adds WS). It has no
// electron imports itself.
// -----------------------------------------------------------------------------

export interface PreloadTransport {
  /** oRPC call: forwards to the server router. Returns a promise. */
  call(path: readonly string[], input: unknown): Promise<unknown>

  /** Fire-and-forget push to the server (terminal:write, shell:openExternal, etc.). */
  send(channel: string, ...args: unknown[]): void

  /** Request/response invoke — for things like `app:wait-services-ready`. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>

  /** Subscribe to a server-pushed channel. Returns an unsubscribe function. */
  on(channel: string, listener: (...args: unknown[]) => void): () => void

  /** Wait until the server is ready to serve RPC calls. */
  waitForReady(): Promise<void>

  /** Environmental capabilities exposed to the renderer. */
  readonly env: WandaEnv

  /**
   * Return the HTTP base URL + bearer session token this transport is
   * authorising with, if the transport knows them. Used by features that
   * need to hit raw HTTP endpoints outside oRPC (e.g. the attachment blob
   * store). Transports that don't speak HTTP (pure in-memory test fakes)
   * may return `null`.
   */
  getConnection?: () => { httpUrl: string; sessionToken: string } | null

  /**
   * Return the server epoch captured at the most recent `hello-ack`, or
   * `null` if the connection hasn't handshaken yet. Callers use this to
   * parameterise `sys:replay-from-scoped` / `sys:replay-from` requests.
   * Transports that don't have a concept of epoch (pure test fakes, IPC
   * paths) may omit this method entirely.
   */
  getServerEpoch?: () => number | null
}

/**
 * Environment capability flags exposed on `window.wanda.env`. Renderer
 * features use these to decide whether to show native-specific UI
 * (tray indicators, global shortcuts, `shell.openExternal` CTAs, etc.).
 *
 * The electron shell and the future browser shim populate these with
 * different values. `platform` is the most coarse-grained signal.
 */
export interface WandaEnv {
  /** Which host process the renderer is running in. */
  readonly platform: 'electron' | 'browser'
  /** Which transport is servicing RPC + events. */
  readonly transport: 'ipc' | 'ws'
  /** True if `shell.openExternal` is the OS shell; false if it's a `window.open` fallback. */
  readonly canOpenExternal: boolean
  /** True if the app has a system tray / menu bar indicator. */
  readonly hasTray: boolean
  /** True if native file/directory dialogs are available. */
  readonly hasNativeDialogs: boolean
  /** True if the app has OS-level menu bar integration. */
  readonly hasNativeMenu: boolean
  /** True if global shortcut forwarding (`shortcut:forward`) is live. */
  readonly hasGlobalShortcuts: boolean
}
