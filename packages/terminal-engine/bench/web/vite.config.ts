import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: '../../dist-bench',
    emptyOutDir: true,
  },
  server: {
    port: 5199,
  },
})
