// -----------------------------------------------------------------------------
// @wanda/client-connection — WebSocket lifecycle, hello handshake, reconnect FSM.
// -----------------------------------------------------------------------------

export { DEFAULT_BACKOFF_MS, pickBackoff } from './backoff.ts'
export type { ClientConnectionOptions } from './client-connection.ts'
export { ClientConnection } from './client-connection.ts'
export type {
  ClientConnectionCallbacks,
  ConnectionState,
  MinimalWebSocket,
  ResumeCursor,
  WebSocketFactory,
} from './types.ts'
export { CONNECTION_STATES } from './types.ts'
