import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { log } from '../../packages/logger'

const execFileAsync = promisify(execFile)

/**
 * Resolve the primary .icns path inside a macOS .app bundle.
 *
 * Reads `CFBundleIconFile` from `Contents/Info.plist` (handling both the
 * "with extension" and "without extension" flavors the key allows), then
 * falls back to the common filenames Electron / native apps ship under.
 *
 * Mirrors the approach used in a prior Rust implementation that did this
 * same job via `CFBundle::info_dictionary()` + common-name fallback.
 */
async function resolveIconPath(appPath: string): Promise<string | null> {
  const resources = join(appPath, 'Contents', 'Resources')
  const infoPlist = join(appPath, 'Contents', 'Info.plist')

  // Primary: CFBundleIconFile lookup via plutil (no native plist dep needed).
  try {
    const { stdout } = await execFileAsync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPlist], {
      timeout: 2000,
    })
    const info = JSON.parse(stdout) as { CFBundleIconFile?: string }
    if (info.CFBundleIconFile) {
      const name = info.CFBundleIconFile
      const candidate = name.endsWith('.icns') ? join(resources, name) : join(resources, `${name}.icns`)
      if (existsSync(candidate)) return candidate
    }
  } catch {
    // plutil / parse failure — fall through to common-name scan.
  }

  // Fallback: common filenames. Order mirrors the prior Rust implementation
  // plus `electron.icns` since most Electron apps ship under that name.
  const common = ['AppIcon.icns', 'Icon.icns', 'app.icns', 'electron.icns']
  for (const name of common) {
    const p = join(resources, name)
    if (existsSync(p)) return p
  }

  return null
}

/**
 * Extract a macOS .app bundle's icon as a PNG data URL.
 *
 * Pipeline: Info.plist → `.icns` path → `sips -s format png -z H W` to a temp
 * file → read bytes → base64-encode → return `data:image/png;base64,...`.
 *
 * IMPORTANT: we deliberately do NOT use `app.getFileIcon` or `nativeImage`.
 * On Electron 40 + macOS 26 `app.getFileIcon` crashes the app with an
 * unrecoverable `SIGTRAP / brk 0` inside a `ThreadPoolForegroundWorker` in
 * Chromium's image decoder. `sips` uses Core Graphics directly and bypasses
 * the Chromium image pipeline entirely, so it's crash-safe.
 *
 * Returns `null` (never throws) if anything goes wrong — caller should
 * treat missing icons as "no icon" and fall through to a generic fallback.
 */
export async function extractAppIconDataUrl(appPath: string, size = 64): Promise<string | null> {
  try {
    const iconPath = await resolveIconPath(appPath)
    if (!iconPath) return null

    const tempPath = join(tmpdir(), `wanda-icon-${randomUUID()}.png`)
    try {
      await execFileAsync(
        '/usr/bin/sips',
        ['-s', 'format', 'png', '-z', String(size), String(size), iconPath, '--out', tempPath],
        { timeout: 5000 },
      )
      const bytes = await readFile(tempPath)
      return `data:image/png;base64,${bytes.toString('base64')}`
    } finally {
      // Best-effort cleanup. Don't let a missing file block the return,
      // but log so a symptomatic temp-dir fill-up can be diagnosed.
      unlink(tempPath).catch((err) => {
        log.main.debug('app-icon: temp cleanup failed:', { tempPath, err: String(err) })
      })
    }
  } catch (err) {
    log.main.debug('app-icon: extract failed:', err)
    return null
  }
}
