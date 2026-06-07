// -----------------------------------------------------------------------------
// JSON envelope codec.
//
// Every non-PTY message on the WebSocket is a JSON envelope:
//   { v: 1, seq, ts, channel, args }
//
// Binary PTY frames (terminal:*) use the separate binary opcode format in
// `./binary-frames.ts` and never pass through this codec.
//
// The codec's job is narrow: serialize/deserialize JSON envelopes with strict
// validation at the wire boundary. Payload typing per channel is layered on
// top by subscribers who know their channel's schema.
// -----------------------------------------------------------------------------

import { z } from 'zod'

export const PROTOCOL_VERSION = 1 as const
export type ProtocolVersion = typeof PROTOCOL_VERSION

export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const

export interface Envelope {
  readonly v: ProtocolVersion
  readonly seq: number
  readonly ts: number
  readonly channel: string
  readonly args: readonly unknown[]
}

// We validate the channel *prefix* at the wire boundary; the specific channel
// name is just a string here. Downstream code narrows via discriminated unions.
//
// New channels SHOULD use `event:<resource>:<action>`. The remaining prefixes
// are grandfathered for channels that predate the resource-event convention
// (pod lifecycle, git/file watchers, agent streaming, oRPC invalidation).
const CHANNEL_PREFIXES = [
  'sys:',
  'event:',
  'terminal:',
  'pod:',
  'git:',
  'file:',
  'agent:',
  'build:',
  'slice:',
  'notifications:',
  'orpc:',
  'workenv.',
] as const

const EnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  channel: z
    .string()
    .min(1)
    .refine((c) => CHANNEL_PREFIXES.some((p) => c.startsWith(p)), {
      message: `channel must start with one of: ${CHANNEL_PREFIXES.join(', ')}`,
    }),
  args: z.array(z.unknown()),
})

export type DecodeError =
  | { readonly type: 'invalid-json'; readonly message: string }
  | { readonly type: 'invalid-shape'; readonly issues: readonly string[] }
  | { readonly type: 'unsupported-version'; readonly got: unknown }

export type DecodeResult =
  | { readonly ok: true; readonly envelope: Envelope }
  | { readonly ok: false; readonly error: DecodeError }

export function encodeEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope)
}

export function decodeEnvelope(text: string): DecodeResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      error: { type: 'invalid-json', message: err instanceof Error ? err.message : String(err) },
    }
  }

  // Version check runs before shape validation so we can return a distinct
  // error code that the client uses to trigger a "new version required" UI.
  if (raw && typeof raw === 'object' && 'v' in raw) {
    const v = (raw as { v: unknown }).v
    if (typeof v !== 'number' || !SUPPORTED_PROTOCOL_VERSIONS.includes(v as ProtocolVersion)) {
      return { ok: false, error: { type: 'unsupported-version', got: v } }
    }
  }

  const parsed = EnvelopeSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
    return { ok: false, error: { type: 'invalid-shape', issues } }
  }

  return { ok: true, envelope: parsed.data as Envelope }
}

/**
 * Decode-or-null helper for hot-path inbound handlers that want a fast
 * discard on invalid frames without branching on the DecodeResult shape.
 */
export function parseEnvelope(text: string): Envelope | null {
  const result = decodeEnvelope(text)
  return result.ok ? result.envelope : null
}

/**
 * Convenience constructor. Callers should prefer this over hand-building
 * objects so the version field is never accidentally omitted.
 */
export function makeEnvelope(
  channel: string,
  args: readonly unknown[],
  opts: { readonly seq?: number; readonly ts?: number } = {},
): Envelope {
  return {
    v: PROTOCOL_VERSION,
    seq: opts.seq ?? 0,
    ts: opts.ts ?? Date.now(),
    channel,
    args,
  }
}
