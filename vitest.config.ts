import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))
const packageProjects = [
  'packages/agent-protocol/vitest.config.ts',
  'packages/agent-providers/vitest.config.ts',
  'packages/agent-runtime/vitest.config.ts',
  'packages/agent-store/vitest.config.ts',
  'packages/agent-ui/vitest.config.ts',
  'packages/client-connection/vitest.config.ts',
  'packages/event-log/vitest.config.ts',
  'packages/gateway/vitest.config.ts',
  'packages/router/vitest.config.ts',
  'packages/session/vitest.config.ts',
  'packages/subscriptions/vitest.config.ts',
  'packages/tasks/vitest.config.ts',
  'packages/terminal-engine/vitest.config.ts',
  'packages/wire/vitest.config.ts',
].map((project) => path.join(dirname, project))

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['electron/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        'electron/**/__tests__/**',
        'electron/**/*.test.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.{ts,tsx}',
        '**/*.d.ts',
        'electron/db/migrations/**',
        'electron/services/workflow/seed.ts',
      ],
    },
    projects: [
      ...packageProjects,
      {
        test: {
          name: 'services',
          include: ['electron/**/*.test.ts', 'shared/**/*.test.ts'],
          exclude: ['electron/**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['electron/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 90_000,
          pool: 'forks',
          fileParallelism: false,
        },
      },
      {
        resolve: {
          alias: { '@': path.join(dirname, 'src') },
        },
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({ configDir: path.join(dirname, '.storybook') }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
          setupFiles: ['.storybook/vitest.setup.ts'],
        },
      },
    ],
  },
})
