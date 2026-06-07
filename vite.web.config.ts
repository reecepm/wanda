// -----------------------------------------------------------------------------
// Vite config for the browser build of Wanda.
//
// Standalone from `electron.vite.config.ts` — this config builds `src/`
// into a static bundle that connects to a running Wanda server over WS.
// No Electron preload, no main process, no tray window.
//
// Usage:
//   bun run web:dev   → Vite dev server on :5173 with HMR (expects a
//                        standalone server running separately on :9191)
//   bun run web:build → production build into dist-web/
// -----------------------------------------------------------------------------

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  publicDir: 'public',
  define: {
    __APP_CHANNEL__: JSON.stringify(process.env.APP_CHANNEL || 'dev'),
  },
  plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Same alias the Electron main build uses, for the same CJS/ESM
      // interop reason (@xterm/headless's bundled entry ships CJS that
      // tsx/node can't import named).
      '@xterm/headless': resolve(__dirname, 'node_modules/@xterm/headless/lib-headless/xterm-headless.mjs'),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
  },
  preview: {
    port: 5174,
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        web: resolve(__dirname, 'web.html'),
      },
      // Exclude things that only make sense in Electron's main process.
      // These should never be reached at runtime from `src/` + the pure
      // preload files we import, but we externalize defensively so a bad
      // accidental import crashes the build instead of silently pulling
      // in node-pty/better-sqlite3/etc.
      external: [
        'electron',
        'better-sqlite3',
        'node-pty',
        'chokidar',
        'dockerode',
        'drizzle-orm/better-sqlite3',
        'drizzle-orm/better-sqlite3/migrator',
      ],
    },
  },
})
