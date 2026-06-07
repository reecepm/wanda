// -----------------------------------------------------------------------------
// Content-addressed blob storage for agent attachments.
//
// Layout:   <baseDir>/<sha256[0:2]>/<sha256>.bin
//
// Bytes are written once per sha256: re-uploading the same file is an
// idempotent no-op on disk, and the per-session DB row provides the
// user-visible dedup. Writes fsync the fd on close so a crash mid-write
// won't leave a zero-length blob masquerading as the real thing.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { open, rename, stat, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface BlobWriteResult {
  readonly sha256: string
  readonly bytes: number
  readonly alreadyExisted: boolean
  readonly path: string
}

function shardDir(baseDir: string, sha256: string): string {
  return join(baseDir, sha256.slice(0, 2))
}

function blobPath(baseDir: string, sha256: string): string {
  return join(shardDir(baseDir, sha256), `${sha256}.bin`)
}

/**
 * Compute sha256 of in-memory bytes. Hex lowercase, 64 chars.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Write bytes to the blob store, keyed by their sha256. Idempotent: if the
 * blob already exists, returns `alreadyExisted: true` and does not rewrite
 * the file. Writes go through a `<path>.tmp.<rand>` staging file + rename
 * so a concurrent reader never sees a partial blob.
 *
 * Safe under concurrent writers (e.g. embedded-mode shell racing with a
 * subprocess-mode server over the same `baseDir`): each writer stages to
 * a unique temp name, then atomically renames onto the same final path.
 * The second rename overwrites the first, but the bytes are identical
 * by construction (content-addressed), so no corruption is possible.
 */
export async function writeBlob(baseDir: string, bytes: Uint8Array): Promise<BlobWriteResult> {
  const sha256 = sha256Hex(bytes)
  const finalPath = blobPath(baseDir, sha256)

  if (existsSync(finalPath)) {
    return { sha256, bytes: bytes.byteLength, alreadyExisted: true, path: finalPath }
  }

  mkdirSync(dirname(finalPath), { recursive: true })
  const tmpPath = `${finalPath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  const handle = await open(tmpPath, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await rename(tmpPath, finalPath)
  } catch (err) {
    // Cleanup the temp file if rename failed (unusual — disk full, crossed
    // devices, etc). Rethrow so the caller surfaces the upload error.
    try {
      await unlink(tmpPath)
    } catch {
      /* ignore */
    }
    throw err
  }
  return { sha256, bytes: bytes.byteLength, alreadyExisted: false, path: finalPath }
}

/** Open a read stream over a stored blob. Throws if missing. */
export function readBlobStream(baseDir: string, sha256: string): NodeJS.ReadableStream {
  return createReadStream(blobPath(baseDir, sha256))
}

/** Return the on-disk byte size of a stored blob, or null if missing. */
export async function statBlob(baseDir: string, sha256: string): Promise<number | null> {
  try {
    const s = await stat(blobPath(baseDir, sha256))
    return s.size
  } catch {
    return null
  }
}

export { blobPath }
