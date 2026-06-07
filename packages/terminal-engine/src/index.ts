// Public API

export type { BatcherOptions, FlushCallback } from './batcher.js'
export { Batcher } from './batcher.js'
export { TerminalEngine } from './engine.js'
export type { FlowControlCallbacks, FlowControlOptions } from './flow-control.js'
export { FlowController } from './flow-control.js'
export type { HeadlessScrollbackOpts } from './headless-scrollback.js'
export { HeadlessScrollback } from './headless-scrollback.js'
export type {
  ClientFrame,
  ServerFrame,
} from './protocol.js'
export {
  encodeServerFrame,
  parseClientFrame,
} from './protocol.js'
export { FrameDecoder, writeFrame } from './pty-host-protocol.js'
export type { SnapshotMeta, StoreErrorHandler } from './snapshot-store.js'
export { SnapshotStore } from './snapshot-store.js'
// Types
export type {
  EngineMetrics,
  EngineOptions,
  PtyConfig,
  TerminalInfo,
} from './types.js'
export type { WsClientOptions } from './ws-client.js'
export { WsTerminalClient } from './ws-client.js'
export type { WsServerOptions } from './ws-server.js'
export { WsTerminalServer } from './ws-server.js'
