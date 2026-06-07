// -----------------------------------------------------------------------------
// Shell ↔ server facade.
//
// Defines the single interface that main.ts consumes regardless of whether the
// server runtime lives in-process (embedded) or in a spawned child process
// (subprocess). Both modes go through `client: RouterClient<AppRouter>` for all
// oRPC work. The facade adds only what the shell needs *beyond* oRPC:
//
//   - a lifecycle handle (stop/connectAndRecover)
//   - direct handles that embedded mode can call without oRPC overhead
//     (ptyService.destroyAll() for the window-close hook)
//
// The two strategies live in sibling modules behind this facade:
//   - `embedded-handle.ts`  — `createEmbeddedHandle`
//   - `subprocess-handle.ts` — `createSubprocessHandle`
// -----------------------------------------------------------------------------

import type { RouterClient } from '@orpc/server'
import type { AppRouter } from '../router/index'

export type AppClient = RouterClient<AppRouter>

/** Server deployment mode. */
export type ServerMode = 'embedded' | 'subprocess'

export interface ShellServerHandle {
  readonly mode: ServerMode
  readonly client: AppClient
  /** Destroy any in-process PTYs on window close. No-op in subprocess mode. */
  readonly destroyAllPtys: () => void
  /** Post-ready kick — connect remote targets + recover containers. */
  readonly connectAndRecover: () => Promise<void>
  /** Stop the server (subprocess) or dispose the runtime (embedded). */
  readonly stop: () => Promise<void>
  /** Fetch the running-pod count (for the tray badge). */
  readonly getRunningPodCount: () => Promise<number>
  /** Check whether the app should hide to tray instead of quitting on window close. */
  readonly getCloseToTray: () => Promise<boolean>
  /** Fetch unresolved notification counts (for the dock badge). */
  readonly getUnresolvedCounts: () => Promise<{ totalBlocking: number }>
  /**
   * Server connection metadata. In subprocess mode this describes how the
   * shell / renderer reaches the child. In embedded mode it describes the
   * in-process HTTP server (if a WsGateway is attached) or is undefined
   * if WS transport isn't configured.
   */
  readonly connection?: {
    readonly httpUrl: string
    readonly wsUrl: string
    readonly token: string
  }
}

export { createEmbeddedHandle, type EmbeddedOpts, type LocalServerHandle } from './embedded-handle'
export {
  __getSubprocessRuntimeStateForTest,
  createSubprocessHandle,
  type EventWsHandle,
  type SubprocessOpts,
} from './subprocess-handle'
