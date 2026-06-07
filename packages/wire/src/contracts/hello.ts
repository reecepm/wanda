// -----------------------------------------------------------------------------
// Hello handshake messages.
//
// These are the very first envelopes exchanged when a client opens a WS
// connection. They are `sys:*` channels and carry a single object in `args`.
//
// See spec §3.3.
// -----------------------------------------------------------------------------

import { z } from 'zod'
import { PROTOCOL_VERSION } from '../envelope.ts'

// --- sys:hello (client → server) ---------------------------------------------

export const HelloSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  clientId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  resumeFromSeq: z.number().int().min(0).optional(),
  /** Last epoch observed; omitted on a truly-fresh session. */
  epoch: z.number().int().min(1).optional(),
})

export type HelloMessage = z.infer<typeof HelloSchema>

// --- sys:hello-ack (server → client) -----------------------------------------

export const HelloAckSchema = z.object({
  serverId: z.string().min(1),
  serverSeq: z.number().int().min(0),
  epoch: z.number().int().min(1),
  protocolSupported: z.array(z.number().int().min(1)).nonempty(),
})

export type HelloAckMessage = z.infer<typeof HelloAckSchema>

// --- sys:hello-rejected (server → client) ------------------------------------

export const HELLO_REJECTED_REASONS = ['unsupported-version', 'invalid-session', 'revoked', 'client-outdated'] as const

export type HelloRejectedReason = (typeof HELLO_REJECTED_REASONS)[number]

export const HelloRejectedSchema = z.object({
  reason: z.enum(HELLO_REJECTED_REASONS),
})

export type HelloRejectedMessage = z.infer<typeof HelloRejectedSchema>

// --- Channel constants --------------------------------------------------------

export const HELLO_CHANNEL = 'sys:hello' as const
export const HELLO_ACK_CHANNEL = 'sys:hello-ack' as const
export const HELLO_REJECTED_CHANNEL = 'sys:hello-rejected' as const
