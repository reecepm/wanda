import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    name: 'agent-ui',
    environment: 'happy-dom',
  },
})
