import { defineConfig } from '@playwright/test'

// Electron E2E: one worker at a time because we launch real Electron
// processes (two of them in the pairing suite) and tests mutate global
// keychain / dock state. Parallel runs clash on those.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
