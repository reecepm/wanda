import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    name: 'gateway',
    pool: 'forks',
    // Generous testTimeout — some tests spin up real HTTP + WS.
    testTimeout: 15_000,
  },
})
