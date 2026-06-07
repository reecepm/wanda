// -----------------------------------------------------------------------------
// IPC bridge: ServerRegistry → renderer.
//
// Wires registry methods onto an abstract IpcHost so Electron's ipcMain
// can be swapped out for a test fake. Production wires in the real
// `ipcMain` from 'electron'; unit tests pass a Map-backed stub.
//
// The renderer calls `transport.invoke('servers:pair', url)` and the
// ws-transport's platformInvoke callback routes to `ipcRenderer.invoke`,
// which reaches these handlers.
// -----------------------------------------------------------------------------

import type { ServerRegistry } from './server-registry'

/**
 * Minimal shape of Electron's ipcMain that this bridge needs. Production
 * passes the real ipcMain; tests pass a Map-backed fake.
 */
export interface IpcHost {
  handle(channel: string, listener: (...args: unknown[]) => unknown | Promise<unknown>): void
  removeHandler(channel: string): void
}

export const SERVERS_IPC_CHANNELS = {
  LIST: 'servers:list',
  PAIR: 'servers:pair',
  REMOVE: 'servers:remove',
  ISSUE_WS_TOKEN: 'servers:issue-ws-token',
  CAPABILITIES: 'servers:capabilities',
  /**
   * Returns the decrypted session token for a paired server.
   *
   * The renderer needs this to sign HTTP RPC calls it makes directly to
   * paired servers (the alternative — proxying every call through main —
   * adds an extra IPC hop per RPC). The token stays encrypted at rest and
   * is only decrypted on demand via this channel. In Electron's trust
   * model the renderer is trusted enough to hold short-lived credentials
   * in memory (comparable to a browser login session).
   */
  GET_SESSION_TOKEN: 'servers:get-session-token',
  /**
   * Triggers the registry's port-heal probe: if the stored baseUrl is
   * stale (the remote restarted on a different port), probe a short
   * list of well-known ports on the same hostname and, on a match,
   * update the stored baseUrl and return the new URL. Returns null
   * when no candidate responds.
   */
  PROBE_AND_HEAL: 'servers:probe-and-heal',
} as const

/**
 * Register ServerRegistry IPC handlers. Returns a teardown function that
 * removes every channel it registered (symmetric cleanup on quit).
 *
 * Each handler ignores the first argument (Electron passes an
 * `IpcMainInvokeEvent` there, which tests' fake does not). Any remaining
 * positional args are forwarded to the corresponding registry method.
 */
export function registerServerRegistryIpc(host: IpcHost, registry: ServerRegistry): () => void {
  host.handle(SERVERS_IPC_CHANNELS.LIST, (..._args: unknown[]) => registry.list())
  host.handle(SERVERS_IPC_CHANNELS.PAIR, (...args: unknown[]) => {
    const url = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof url !== 'string') throw new Error('servers:pair requires a URL string')
    return registry.pair(url)
  })
  host.handle(SERVERS_IPC_CHANNELS.REMOVE, (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof id !== 'string') throw new Error('servers:remove requires an id string')
    registry.remove(id)
  })
  host.handle(SERVERS_IPC_CHANNELS.ISSUE_WS_TOKEN, (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof id !== 'string') throw new Error('servers:issue-ws-token requires an id string')
    return registry.issueWsToken(id)
  })
  host.handle(SERVERS_IPC_CHANNELS.CAPABILITIES, (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof id !== 'string') throw new Error('servers:capabilities requires an id string')
    return registry.capabilities(id)
  })
  host.handle(SERVERS_IPC_CHANNELS.GET_SESSION_TOKEN, (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof id !== 'string') throw new Error('servers:get-session-token requires an id string')
    return registry.getSessionToken(id)
  })
  host.handle(SERVERS_IPC_CHANNELS.PROBE_AND_HEAL, (...args: unknown[]) => {
    const id = typeof args[0] === 'string' ? args[0] : args[1]
    if (typeof id !== 'string') throw new Error('servers:probe-and-heal requires an id string')
    return registry.probeAndHeal(id)
  })
  return () => {
    for (const channel of Object.values(SERVERS_IPC_CHANNELS)) {
      host.removeHandler(channel)
    }
  }
}
