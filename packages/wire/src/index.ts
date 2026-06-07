// -----------------------------------------------------------------------------
// @wanda/wire — protocol codec + envelope types. Shared by client and server.
//
// This package is the ONLY place protocol types may be declared. Every other
// package imports from here; an ESLint rule forbids re-declaring brands or
// envelope shapes elsewhere.
// -----------------------------------------------------------------------------

export type { Frame, FrameDecodeError, FrameDecodeResult } from './binary-frames.ts'
// Binary frames
export {
  decodeExitPayload,
  decodeFrame,
  decodeResizePayload,
  encodeExitPayload,
  encodeFrame,
  encodeResizePayload,
  FRAME_HEADER_BYTES,
  FrameOpcode,
  MAX_PAYLOAD_BYTES,
} from './binary-frames.ts'
export type { EventChannel } from './contracts/events.ts'
// Events
export { EVENT_CHANNELS, eventResourceKind, isEventChannel } from './contracts/events.ts'
export type { HelloAckMessage, HelloMessage, HelloRejectedMessage, HelloRejectedReason } from './contracts/hello.ts'
// Hello
export {
  HELLO_ACK_CHANNEL,
  HELLO_CHANNEL,
  HELLO_REJECTED_CHANNEL,
  HELLO_REJECTED_REASONS,
  HelloAckSchema,
  HelloRejectedSchema,
  HelloSchema,
} from './contracts/hello.ts'
export type {
  AgentId,
  AgentRef,
  AgentSessionId,
  AgentSessionRef,
  AnyResourceRef,
  CommandId,
  CommandRef,
  PodId,
  PodItemId,
  PodItemRef,
  PodRef,
  PortId,
  PortRef,
  ResourceRef,
  ResourceRefMap,
  TerminalId,
  TerminalRef,
  ViewId,
  ViewRef,
  WorkspaceId,
  WorkspaceRef,
} from './contracts/refs.ts'
export {
  AgentRefSchema,
  AgentSessionRefSchema,
  AnyRefSchema,
  agentRef,
  agentSessionRef,
  CommandRefSchema,
  commandRef,
  isRefOfKind,
  PodItemRefSchema,
  PodRefSchema,
  PortRefSchema,
  parseRef,
  podItemRef,
  podRef,
  portRef,
  RefSchemaByKind,
  TerminalRefSchema,
  terminalRef,
  ViewRefSchema,
  viewRef,
  WorkspaceRefSchema,
  workspaceRef,
} from './contracts/refs.ts'
export type { ResourceKind } from './contracts/resources.ts'
// Resources + Refs
export { isResourceKind, RESOURCE_KINDS } from './contracts/resources.ts'
export type { DecodeError, DecodeResult, Envelope, ProtocolVersion } from './envelope.ts'
// Envelope codec
export {
  decodeEnvelope,
  encodeEnvelope,
  makeEnvelope,
  PROTOCOL_VERSION,
  parseEnvelope,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './envelope.ts'
