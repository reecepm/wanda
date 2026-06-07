import os from 'node:os'
import { join } from 'node:path'

export type AppChannel = 'stable' | 'dev'

declare const __APP_CHANNEL__: string | undefined

/**
 * Build channel — set at compile time via electron-vite `define`.
 * Packaged stable builds set APP_CHANNEL=stable; everything else defaults to 'dev'.
 */
const _channel = typeof __APP_CHANNEL__ !== 'undefined' ? __APP_CHANNEL__ : 'dev'
export const APP_CHANNEL: AppChannel = _channel === 'stable' ? 'stable' : 'dev'

export const isDev = APP_CHANNEL === 'dev'

/** Dot-directory under ~ for app-specific files (MCP port, SSH keys, daemon token) */
export const APP_DOT_DIR = join(os.homedir(), isDev ? '.wanda-dev' : '.wanda')

/** Docker container label key prefix — e.g. `wanda.pod` or `wanda-dev.pod` */
export const LABEL_PREFIX = isDev ? 'wanda-dev' : 'wanda'

/** Docker container name prefix */
export const CONTAINER_PREFIX = isDev ? 'wanda-dev' : 'wanda'

/** Database filename inside userData */
export const DB_FILENAME = isDev ? 'wanda-dev.db' : 'wanda.db'

/** MCP TOML section name for codex config */
export const MCP_SECTION = isDev ? 'wanda-dev' : 'wanda'

/** Display name for the app */
export const APP_NAME = isDev ? 'Wanda Dev' : 'Wanda'

/** Platform app identity. Keep in sync with electron-builder*.yml. */
export const APP_ID = isDev ? 'com.wanda.dev' : 'com.wanda.app'
