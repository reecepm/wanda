import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: {
    define: {
      __APP_CHANNEL__: JSON.stringify(process.env.APP_CHANNEL || 'dev'),
    },
    resolve: {
      alias: {
        '@xterm/headless': resolve(__dirname, 'node_modules/@xterm/headless/lib-headless/xterm-headless.mjs'),
      },
    },
    build: {
      externalizeDeps: {
        exclude: [
          'effect-orpc',
          '@xterm/headless',
          '@xterm/addon-serialize',
          // Workspace packages that ship raw .ts via "exports". Inlining
          // them avoids ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING when
          // the packaged Electron Node tries to load them from asar.
          '@wanda/agent-protocol',
          '@wanda/agent-providers',
          '@wanda/agent-runtime',
          '@wanda/agent-store',
          '@wanda/agent-ui',
          '@wanda/client-connection',
          '@wanda/event-log',
          '@wanda/gateway',
          '@wanda/router',
          '@wanda/session',
          '@wanda/subscriptions',
          '@wanda/tasks',
          '@wanda/wire',
        ],
      },
      lib: {
        entry: {
          // main entry for the Electron shell. Emitted as out/main/main.js
          // (package.json's "main" field).
          main: resolve(__dirname, 'electron/main.ts'),
          // Standalone server entry. Emitted as out/main/server.js
          // alongside the shell, with shared chunks deduped by Rollup.
          server: resolve(__dirname, 'electron/server/bin.ts'),
        },
        formats: ['es'],
      },
      rollupOptions: {
        external: ['better-sqlite3'],
      },
    },
  },
  preload: {
    build: {
      // Preload imports `@wanda/*` workspace packages whose `exports` point
      // at raw .ts. If those stay externalized, the packaged preload fails
      // to load (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), `window.wanda`
      // never installs, and the renderer throws on `window.wanda.app`.
      externalizeDeps: {
        exclude: ['@wanda/agent-protocol', '@wanda/client-connection', '@wanda/wire'],
      },
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: '.',
    define: {
      __APP_CHANNEL__: JSON.stringify(process.env.APP_CHANNEL || 'dev'),
    },
    plugins: [TanStackRouterVite({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    worker: {
      format: 'es',
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          tray: resolve(__dirname, 'tray.html'),
        },
      },
    },
  },
})
