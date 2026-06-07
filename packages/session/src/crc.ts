// -----------------------------------------------------------------------------
// CRC32 wrapper — thin adapter over node:zlib's crc32.
//
// Used to seal the server_identity.epoch_crc column against torn writes on a
// disk-full event. Not cryptographic; purely integrity.
// -----------------------------------------------------------------------------

import { crc32 as zlibCrc32 } from 'node:zlib'

export function crc32Of(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`crc32Of: value must be a non-negative integer (got ${value})`)
  }
  // Serialize as a canonical big-endian u32 for stability across machines.
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(value, 0)
  return zlibCrc32(buf)
}
