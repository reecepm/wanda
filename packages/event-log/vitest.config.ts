import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    name: 'event-log',
    // better-sqlite3 native module: single threaded per DB instance. Use forks
    // to avoid worker-pool issues with the native binding.
    pool: 'forks',
  },
})
